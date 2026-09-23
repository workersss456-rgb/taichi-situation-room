// =====================================================================
// 太綺戰情室 — 後端 API（Render 部署用）
// 取代原本的 Google Apps Script，資料庫改用 Neon (Postgres)
// =====================================================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

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
    cols: ['案場ID','方式','日期','金額','銀行','支票號碼','手續費','狀態','對應發票ID','備註']
  },
  '支出登記': {
    idCol: '支出ID', prefix: 'E', pad: 4,
    cols: ['案場ID','類型','日期','廠商ID','發票號碼','項目','金額(含稅)','點工人員ID','工項','數量','小計','代扣所得稅','代扣二代健保','實際支付金額','備註']
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
    if (action === 'createRow') {
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

app.get('/', (req, res) => res.send('太綺戰情室 API 運作中'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on port ' + PORT));
