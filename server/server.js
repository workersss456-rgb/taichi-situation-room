// =====================================================================
// 太綺戰情室 — 後端 API（Render 部署用）
// 取代原本的 Google Apps Script，資料庫改用 Neon (Postgres)
// ---------------------------------------------------------------------
// 2026-09-23 修正版
//  1. CORS 設定容錯：允許多個來源、自動去掉結尾斜線與路徑、對不上時寫日誌
//  2. /api/data 未登入改為「白名單」回傳，避免資料表新增敏感欄位就外洩
//  3. JWT_SECRET 不再有預設值（預設值等於任何人都能偽造管理員 token）
//  4. 新增 /api/health 供自我診斷（只回布林值與來源設定，不回任何密鑰）
// =====================================================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---------------------------------------------------------------------
// 啟動前檢查：密鑰沒設就不要啟動
// ---------------------------------------------------------------------
// 原本 JWT_SECRET 落到預設值 'change-me-please' 時，任何人都能自己簽一個
// { authorized: true } 的 token，直接取得完整寫入權限，密碼那關等於不存在。
// 寧可啟動失敗讓你在 Render 日誌看到，也不要安靜地開著後門。
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const fatal = [];
if (!process.env.DATABASE_URL) fatal.push('DATABASE_URL（Neon 連線字串）');
if (!ADMIN_PASSWORD) fatal.push('ADMIN_PASSWORD（登入密碼）');
if (!JWT_SECRET) fatal.push('JWT_SECRET（token 簽章密鑰，請用長隨機字串）');
else if (JWT_SECRET.length < 16) fatal.push('JWT_SECRET 太短，請用至少 16 字元的隨機字串');
else if (/^(change-me|changeme|secret|password|test)/i.test(JWT_SECRET)) {
  fatal.push('JWT_SECRET 看起來是預設或範例值，請換成真正的隨機字串');
}
if (fatal.length) {
  console.error('🚨 缺少必要的環境變數，伺服器不啟動：');
  fatal.forEach((m) => console.error('   - ' + m));
  console.error('   設定位置：Render → 該服務 → Environment');
  console.error('   產生 JWT_SECRET 可用：openssl rand -base64 32');
  process.exit(1);
}

// ---------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------
// 瀏覽器送出的 Origin 標頭只有「scheme + 網域（+ 埠號）」，永遠不含路徑，
// 例如 https://workersss456-rgb.github.io
// 所以環境變數如果填成完整頁面網址（帶 /taichi-situation-room/）或帶結尾
// 斜線，字串比對永遠對不上，後端就不會送 Access-Control-Allow-Origin，
// 瀏覽器會擋掉回應，前端只看得到 "Failed to fetch"。
// 這裡把常見的填法都正規化掉，並在對不上時把實際收到的 Origin 寫進日誌。
function normalizeOrigin(value) {
  const s = String(value || '').trim();
  if (!s || s === '*') return s;
  try {
    // 有路徑也沒關係，URL 解析後只取 origin
    return new URL(s).origin;
  } catch (e) {
    return s.replace(/\/+$/, '');
  }
}

const rawAllowed = process.env.ALLOWED_ORIGIN || '*';
const allowAll = rawAllowed.trim() === '*';
const ALLOWED_ORIGINS = allowAll
  ? []
  : rawAllowed.split(',').map(normalizeOrigin).filter(Boolean);

if (allowAll) {
  console.warn('⚠️  ALLOWED_ORIGIN 未設定，目前允許任何來源。正式環境請設為前端網域，例如 https://workersss456-rgb.github.io');
} else {
  console.log('✅ 允許的前端來源：' + ALLOWED_ORIGINS.join(', '));
  if (rawAllowed !== ALLOWED_ORIGINS.join(',')) {
    console.log('   （已自動正規化，原始設定值為：' + rawAllowed + '）');
  }
}

const seenRejected = new Set();
app.use(cors({
  origin(origin, callback) {
    // 沒有 Origin 的請求（curl、Render 健康檢查、同源請求）一律放行
    if (!origin) return callback(null, true);
    if (allowAll) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(normalizeOrigin(origin))) return callback(null, true);
    // 對不上時留一筆日誌，這是這類問題最快的線索
    if (!seenRejected.has(origin)) {
      seenRejected.add(origin);
      console.warn(`🚫 CORS 拒絕來源 "${origin}"。目前允許：${ALLOWED_ORIGINS.join(', ') || '（無）'}`);
      console.warn('   若這是你的前端，請把 ALLOWED_ORIGIN 改成上面引號裡那一串（不含路徑、不含結尾斜線）。');
    }
    // 回 false 而不是丟錯：瀏覽器照樣會擋，但不會在 Render 留下一堆 500
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
// 註：不要寫 app.options('*', cors())。
// cors() 掛在 app.use 上時本來就會攔下並回應 OPTIONS 預檢請求，
// 而 Express 5 的路由器（path-to-regexp v8）不接受裸的 '*'，寫了會讓服務啟動失敗。

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')
    ? false
    : { rejectUnauthorized: false },   // Neon 需要 SSL
});

// ---------------------------------------------------------------------
// 每張表的設定：表名 / 主鍵欄位 / 產生新 ID 用的前綴 / 允許寫入的欄位
// ---------------------------------------------------------------------
// 注意：cols 同時也是「未登入時允許讀取」的白名單。
// 資料表裡沒列在這裡的欄位（例如之後新增的銀行帳號），未登入一律不回傳。
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
    maskedCols: ['身分證字號']   // 在白名單內，但未登入時顯示為 ***
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

// 未登入時的可見範圍：白名單制。
// 原本用 SELECT * 再事後遮蔽，只要資料表多一個敏感欄位就會安靜外洩；
// 改成「只回 cols 列出的欄位」，預設拒絕，加新欄位不會漏。
function publicView(sheetName, rows, isAuthorized) {
  if (isAuthorized) return rows;
  const cfg = TABLES[sheetName];
  const allow = new Set([cfg.idCol, ...cfg.cols]);
  const masked = cfg.maskedCols || [];
  return rows.map((r) => {
    const out = {};
    for (const k of Object.keys(r)) if (allow.has(k)) out[k] = r[k];
    masked.forEach((c) => { if (out[c]) out[c] = '***'; });
    return out;
  });
}

async function logChange(client, actor, action, sheetName, rowId, note) {
  await client.query(
    `INSERT INTO "變更記錄"("時間","操作人","動作","目標分頁","目標ID","備註") VALUES (now()::text,$1,$2,$3,$4,$5)`,
    [actor, action, sheetName, rowId, note || null]
  );
}

// ---------------------------------------------------------------------
// 自我診斷：只回設定「有沒有設」與允許來源，不回任何密鑰內容
// ---------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  const out = {
    status: 'ok',
    time: new Date().toISOString(),
    config: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      ADMIN_PASSWORD: !!ADMIN_PASSWORD,
      JWT_SECRET: !!JWT_SECRET,
      ALLOWED_ORIGIN: allowAll ? '*（允許任何來源）' : ALLOWED_ORIGINS.join(', '),
    },
    yourOrigin: req.headers.origin || '（這個請求沒有 Origin 標頭）',
  };
  if (req.headers.origin) {
    out.originAllowed = allowAll || ALLOWED_ORIGINS.includes(normalizeOrigin(req.headers.origin));
    if (!out.originAllowed) {
      out.hint = `請把 ALLOWED_ORIGIN 設為 "${normalizeOrigin(req.headers.origin)}"（不含路徑、不含結尾斜線）`;
    }
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      out.database = 'connected';
    } finally { client.release(); }
  } catch (err) {
    out.status = 'degraded';
    out.database = 'error: ' + err.message;
  }
  res.json(out);
});

// ---------------------------------------------------------------------
// 登入：單一管理密碼（在 Render 環境變數 ADMIN_PASSWORD 設定）
// ---------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
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
      out[sheetName] = publicView(sheetName, cleaned, isAuthorized);
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
