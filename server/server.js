// =====================================================================
// 太綺戰情室 — 後端 API（Render 部署用）
// 取代原本的 Google Apps Script，資料庫改用 Neon (Postgres)
// =====================================================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));

// 靜態文件服務（提供 index.html）
app.use(express.static(path.join(__dirname, '..')));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Neon 需要 SSL
});

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-please';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // 明碼存在 Render 環境變數即可，不落地到程式碼

// ---------------------------------------------------------------------
// 每張表的設定：表名 / 主鍵欄位 / 產生新 ID 用的前綴 / 允許寫入的欄位
// ---------------------------------------------------------------------
const TABLES = {
  '案場主檔': {
    idCol: '案場ID', prefix: 'P', pad: 4,
    cols: ['案場名稱','業主','主約未稅金額','主約稅額','主約含稅金額','預設付款條件','預設付款方式','狀態','開案日期','備註']
  },
  '合約明細': {
    idCol: '明細ID', prefix: 'C', pad: 4,
    cols: ['案場ID','類型','序號','項目名稱','未稅金額','稅額','含稅金額','日期','備註']
  },
  '廠商主檔': {
    idCol: '廠商ID', prefix: 'V', pad: 4,
    cols: ['統一編號','廠商名稱','地址','聯絡人','電話','建立日期','備註']
  },
  '點工人員主檔': {
    idCol: '人員ID', prefix: 'W', pad: 4,
    cols: ['姓名','身分證字號','建立日期','備註'],
    sensitiveCols: ['身分證字號'] // 未登入時遮蔽
  },
  '月度請款': {
    idCol: '請款ID', prefix: 'B', pad: 4,
    cols: ['案場ID','年月','預估請款金額','收入方式','現金比例','支票比例','備註']
  },
  '發票登記': {
    idCol: '發票ID', prefix: 'I', pad: 4,
    cols: ['案場ID','類型','統一編號','發票日期','發票號碼','項目','金額(含稅)','備註']
  },
  '收款登記': {
    idCol: '收款ID', prefix: 'R', pad: 4,
    cols: ['案場ID','方式','日期','金額','銀行','支票號碼','手續費','狀態','對應發票ID','對應預估收入ID','備註']
  },
  '支出登記': {
    idCol: '支出ID', prefix: 'E', pad: 4,
    cols: ['案場ID','類型','日期','廠商ID','發票號碼','項目','金額(含稅)','點工人員ID','工項','數量','小計','代扣所得稅','代扣二代健保','實際支付金額','撥款狀態','撥款日期','已撥金額','備註']
  },
  '預估收入': {
    idCol: '預估收入ID', prefix: 'F', pad: 4,
    cols: ['案場ID','年月','方式','預估金額','預計入帳日','已完成','完成日期','對應收款ID','備註']
  },
  '預估支出': {
    idCol: '預估支出ID', prefix: 'X', pad: 4,
    cols: ['案場ID','年月','類別','預估金額','備註']
  },
  '案場預算': {
    idCol: '案場ID', fixedId: true, // 案場ID 本身就是主鍵，一案場一筆，寫入即 upsert
    cols: ['材料預算','發包預算','點工預算','其他預算','預計完工日','備註']
  }
};

// ---------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------
function q(id) { return '"' + id.replace(/"/g, '""') + '"'; }

function getAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.body && req.body._authToken) || req.query.token;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

async function nextId(client, sheetName) {
  const { idCol, prefix, pad } = TABLES[sheetName];
  const table = q(sheetName);
  const { rows } = await client.query(
    `SELECT ${q(idCol)} AS id FROM ${table} WHERE ${q(idCol)} LIKE $1`,
    [prefix + '%']
  );
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.id).slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(pad, '0');
}

async function bumpVersion(client) {
  const { rows } = await client.query(`UPDATE "_meta" SET value = (value::int + 1)::text WHERE key='data_version' RETURNING value`);
  return rows[0] ? rows[0].value : '1';
}

async function currentVersion(client) {
  const { rows } = await client.query(`SELECT value FROM "_meta" WHERE key='data_version'`);
  return rows[0] ? rows[0].value : '1';
}

function maskSensitive(sheetName, rows, isAuthorized) {
  const cfg = TABLES[sheetName];
  if (!cfg || !cfg.sensitiveCols || isAuthorized) return rows;
  return rows.map(r => {
    const copy = { ...r };
    cfg.sensitiveCols.forEach(c => { if (copy[c]) copy[c] = '***'; });
    return copy;
  });
}

async function logChange(client, actor, action, sheetName, rowId, note) {
  await client.query(
    `INSERT INTO "變更記錄"("時間","操作人","動作","目標分頁","目標ID","備註") VALUES (now()::text,$1,$2,$3,$4,$5)`,
    [actor, action, sheetName, rowId, note || null]
  );
}

// ---------------------------------------------------------------------
// 登入：單一管理密碼（在 Render 環境變數 ADMIN_PASSWORD 設定）
// ---------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(500).json({ status: 'error', message: '伺服器尚未設定 ADMIN_PASSWORD' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: 'error', message: '密碼錯誤' });
  const token = jwt.sign({ authorized: true }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ status: 'ok', token, isAuthorized: true, expiresIn: 30 * 24 * 3600 });
});

// ---------------------------------------------------------------------
// GET /api/data — 一次拉全部分頁，格式跟前端的 DATA 物件一致
// ---------------------------------------------------------------------
app.get('/api/data', async (req, res) => {
  const auth = getAuth(req);
  const isAuthorized = !!(auth && auth.authorized);
  const client = await pool.connect();
  try {
    const out = { _isAuthorized: isAuthorized };
    for (const sheetName of Object.keys(TABLES)) {
      const { rows } = await client.query(`SELECT * FROM ${q(sheetName)} ORDER BY "更新時間" ASC NULLS FIRST`);
      const cleaned = rows.map(({ 更新時間, ...rest }) => rest);
      out[sheetName] = maskSensitive(sheetName, cleaned, isAuthorized);
    }
    out['_serverVersion'] = await currentVersion(client);
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// POST /api/action — createRow / updateRow / deleteRow
// ---------------------------------------------------------------------
app.post('/api/action', async (req, res) => {
  const { action, sheetName, rowId, data, _clientVersion } = req.body || {};
  const auth = getAuth(req);
  if (!auth || !auth.authorized) {
    return res.status(401).json({ status: 'unauthorized', message: '請先登入授權帳號才能編輯' });
  }
  const cfg = TABLES[sheetName];
  if (!cfg) return res.status(400).json({ status: 'error', message: '未知的分頁：' + sheetName });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (_clientVersion) {
      const serverVer = await currentVersion(client);
      if (String(_clientVersion) !== String(serverVer)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ status: 'conflict', message: '資料已被更新過（目前版本 ' + serverVer + '），請重新讀取後再編輯' });
      }
    }

    let resultId = rowId;
    if (cfg.fixedId && (action === 'createRow' || action === 'updateRow')) {
      // upsert：案場ID 本身當主鍵，不產生新 ID，寫入即覆蓋
      resultId = rowId || (data && data[cfg.idCol]);
      if (!resultId) throw new Error('缺少 ' + cfg.idCol);
      const cols = cfg.cols.filter(c => data && data[c] !== undefined);
      const values = cols.map(c => data[c]);
      const placeholders = cols.map((_, i) => `$${i + 2}`);
      const updateSets = cols.map(c => `${q(c)} = EXCLUDED.${q(c)}`).concat([`"更新時間" = now()`]);
      await client.query(
        `INSERT INTO ${q(sheetName)} (${q(cfg.idCol)}, ${cols.map(q).join(',')}) VALUES ($1, ${placeholders.join(',')})
         ON CONFLICT (${q(cfg.idCol)}) DO UPDATE SET ${updateSets.join(',')}`,
        [resultId, ...values]
      );
      await logChange(client, 'admin', '設定', sheetName, resultId);
    } else if (action === 'createRow') {
      resultId = await nextId(client, sheetName);
      const cols = cfg.cols.filter(c => data && data[c] !== undefined);
      const values = cols.map(c => data[c]);
      const placeholders = cols.map((_, i) => `$${i + 2}`);
      await client.query(
        `INSERT INTO ${q(sheetName)} (${q(cfg.idCol)}, ${cols.map(q).join(',')}) VALUES ($1, ${placeholders.join(',')})`,
        [resultId, ...values]
      );
      await logChange(client, 'admin', '新增', sheetName, resultId);
    } else if (action === 'updateRow') {
      if (!rowId) throw new Error('缺少 rowId');
      const cols = cfg.cols.filter(c => data && data[c] !== undefined);
      if (cols.length) {
        const sets = cols.map((c, i) => `${q(c)} = $${i + 2}`);
        const values = cols.map(c => data[c]);
        await client.query(
          `UPDATE ${q(sheetName)} SET ${sets.join(',')}, "更新時間" = now() WHERE ${q(cfg.idCol)} = $1`,
          [rowId, ...values]
        );
      }
      await logChange(client, 'admin', '更新', sheetName, rowId);
    } else if (action === 'deleteRow') {
      if (!rowId) throw new Error('缺少 rowId');
      await client.query(`DELETE FROM ${q(sheetName)} WHERE ${q(cfg.idCol)} = $1`, [rowId]);
      await logChange(client, 'admin', '刪除', sheetName, rowId);
    } else {
      throw new Error('未知的 action：' + action);
    }

    const newVersion = await bumpVersion(client);
    await client.query('COMMIT');
    res.json({ status: 'ok', id: resultId, serverVersion: newVersion });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

// --------- 儀表板 API ---------
// GET /api/dashboard?year=2026&month=10 — 月初看板（KPI、各案場收支、每日數據）
app.get('/api/dashboard', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const today = new Date().getDate();

  const client = await pool.connect();
  try {
    // 1. 案場列表
    const { rows: projects } = await client.query(`SELECT "案場ID", "案場名稱", "業主", "主約含稅金額" FROM "案場主檔" ORDER BY "案場ID"`);

    // 2. 預估收入（按方式：現金/支票）
    const { rows: estIncome } = await client.query(
      `SELECT "案場ID", "方式", SUM("預估金額"::numeric) as amt, MIN(COALESCE("預計入帳日"::int, 1)) as minDay
       FROM "預估收入" WHERE "年月" = $1 GROUP BY "案場ID", "方式"`,
      [yearMonth]
    );

    // 3. 實際收入（發票+收款）
    const { rows: actIncome } = await client.query(
      `SELECT i."案場ID", r."方式" as method, SUM(r."金額"::numeric) as amt, MIN(COALESCE(r."日期"::int, 1)) as minDay
       FROM "發票登記" i
       LEFT JOIN "收款登記" r ON i."發票ID" = r."對應發票ID"
       WHERE i."發票日期" LIKE $1 AND r."日期" IS NOT NULL
       GROUP BY i."案場ID", r."方式"`,
      [yearMonth.slice(0, 4) + '%']
    );

    // 4. 預估支出（按類別：材料、工數、發包、其他）
    const { rows: estExpense } = await client.query(
      `SELECT "案場ID", "類別", SUM("預估金額"::numeric) as amt FROM "預估支出" WHERE "年月" = $1 GROUP BY "案場ID", "類別"`,
      [yearMonth]
    );

    // 5. 實際支出（按類型）
    const { rows: actExpense } = await client.query(
      `SELECT "案場ID", "類型", SUM(COALESCE("實際支付金額", "金額(含稅)")::numeric) as amt, MIN("日期"::int) as minDay
       FROM "支出登記" WHERE "日期" LIKE $1 GROUP BY "案場ID", "類型"`,
      [yearMonth.slice(0, 4) + '%']
    );

    // 6. 已請款金額（各案場）
    const { rows: billedAmounts } = await client.query(
      `SELECT "案場ID", SUM("預估請款金額"::numeric) as billed FROM "月度請款" WHERE "年月" = $1 GROUP BY "案場ID"`,
      [yearMonth]
    );

    // 組裝響應
    const projectMap = {};
    projects.forEach(p => {
      projectMap[p['案場ID']] = {
        projectId: p['案場ID'],
        name: p['案場名稱'],
        contractor: p['業主'],
        contractAmount: parseFloat(p['主約含稅金額'] || 0),
        billedAmount: 0
      };
    });

    billedAmounts.forEach(b => {
      if (projectMap[b['案場ID']]) projectMap[b['案場ID']].billedAmount = parseFloat(b.billed || 0);
    });

    // 預估收入（分現金和支票）
    const estimatedIncome = [];
    estIncome.forEach(row => {
      estimatedIncome.push({
        projectIdx: projects.findIndex(p => p['案場ID'] === row['案場ID']),
        amount: parseFloat(row.amt || 0),
        paymentMethod: row['方式'],
        date: parseInt(row.minDay) || 1
      });
    });

    // 實際收入（分現金和支票）
    const actualIncome = [];
    actIncome.forEach(row => {
      actualIncome.push({
        projectIdx: projects.findIndex(p => p['案場ID'] === row['案場ID']),
        amount: parseFloat(row.amt || 0),
        paymentMethod: row.method,
        date: parseInt(row.minDay) || 1
      });
    });

    // 預估支出（按類別分類）
    const estimatedExpense = projects.map(p => [
      estExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類別'] === '材料').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      estExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類別'] === '工數').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      estExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類別'] === '發包').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      estExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類別'] === '其他').reduce((s, e) => s + parseFloat(e.amt || 0), 0)
    ]);

    // 實際支出（按類型分類）
    const actualExpense = projects.map(p => [
      actExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類型'] === '材料').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      actExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類型'] === '工數').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      actExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類型'] === '發包').reduce((s, e) => s + parseFloat(e.amt || 0), 0),
      actExpense.filter(e => e['案場ID'] === p['案場ID'] && e['類型'] === '其他').reduce((s, e) => s + parseFloat(e.amt || 0), 0)
    ]);

    // 支出詳情（每日）
    const { rows: dailyExpenses } = await client.query(
      `SELECT "日期"::int as date, SUM(COALESCE("實際支付金額", "金額(含稅)")::numeric) as amt FROM "支出登記" WHERE "日期" LIKE $1 GROUP BY "日期" ORDER BY "日期"`,
      [yearMonth.slice(0, 4) + '%']
    );

    const expenses = dailyExpenses.map(e => ({
      date: e.date,
      amount: parseFloat(e.amt || 0),
      vendor: '支出'
    }));

    res.json({
      yearMonth,
      today,
      projects: Object.values(projectMap),
      estimatedIncome,
      actualIncome,
      estimatedExpense,
      actualExpense,
      expenses
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

app.get('/', (req, res) => res.send('太綺戰情室 API 運作中'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on port ' + PORT));
