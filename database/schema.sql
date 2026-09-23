-- =====================================================================
-- 太綺戰情室 / 案場成本控制中心 — Neon (Postgres) schema
-- 直接沿用試算表分頁的中文欄位名稱，前端幾乎不用改（少改 API 網址即可）
-- 在 Neon 的 SQL Editor 貼上整份執行一次即可
-- =====================================================================

CREATE TABLE IF NOT EXISTS "案場主檔" (
  "案場ID"        TEXT PRIMARY KEY,
  "案場名稱"      TEXT NOT NULL,
  "業主"          TEXT,
  "主約未稅金額"  NUMERIC DEFAULT 0,
  "主約稅額"      NUMERIC DEFAULT 0,
  "主約含稅金額"  NUMERIC DEFAULT 0,
  "預設付款條件"  TEXT,
  "預設付款方式"  TEXT,
  "狀態"          TEXT DEFAULT '進行中',
  "開案日期"      TEXT,
  "備註"          TEXT,
  "更新時間"      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "合約明細" (
  "明細ID"    TEXT PRIMARY KEY,
  "案場ID"    TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "類型"      TEXT,          -- 主約 / 追加
  "序號"      INTEGER,
  "項目名稱"  TEXT,
  "未稅金額"  NUMERIC DEFAULT 0,
  "稅額"      NUMERIC DEFAULT 0,
  "含稅金額"  NUMERIC DEFAULT 0,
  "日期"      TEXT,
  "備註"      TEXT,
  "更新時間"  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "廠商主檔" (
  "廠商ID"    TEXT PRIMARY KEY,
  "統一編號"  TEXT,
  "廠商名稱"  TEXT NOT NULL,
  "地址"      TEXT,
  "聯絡人"    TEXT,
  "電話"      TEXT,
  "建立日期"  TEXT,
  "備註"      TEXT,
  "更新時間"  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "點工人員主檔" (
  "人員ID"      TEXT PRIMARY KEY,
  "姓名"        TEXT NOT NULL,
  "身分證字號"  TEXT,
  "建立日期"    TEXT,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "月度請款" (
  "請款ID"      TEXT PRIMARY KEY,
  "案場ID"      TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "年月"        TEXT,       -- YYYY-MM
  "預估請款金額" NUMERIC DEFAULT 0,
  "收入方式"    TEXT,
  "現金比例"    NUMERIC DEFAULT 0,
  "支票比例"    NUMERIC DEFAULT 0,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "發票登記" (
  "發票ID"      TEXT PRIMARY KEY,
  "案場ID"      TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "類型"        TEXT,       -- 三聯發票 / 折讓 / 扣抵
  "統一編號"    TEXT,
  "發票日期"    TEXT,
  "發票號碼"    TEXT,
  "項目"        TEXT,
  "金額(含稅)"  NUMERIC DEFAULT 0,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "收款登記" (
  "收款ID"      TEXT PRIMARY KEY,
  "案場ID"      TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "方式"        TEXT,
  "日期"        TEXT,
  "金額"        NUMERIC DEFAULT 0,
  "銀行"        TEXT,
  "支票號碼"    TEXT,
  "手續費"      NUMERIC DEFAULT 0,
  "狀態"        TEXT,
  "對應發票ID"  TEXT,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "支出登記" (
  "支出ID"        TEXT PRIMARY KEY,
  "案場ID"        TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "類型"          TEXT,     -- 材料設備 / 發票-發包 / 發票-點工 / 報酬單-點工 / 現金-點工
  "日期"          TEXT,
  "廠商ID"        TEXT REFERENCES "廠商主檔"("廠商ID"),
  "發票號碼"      TEXT,
  "項目"          TEXT,
  "金額(含稅)"    NUMERIC DEFAULT 0,
  "點工人員ID"    TEXT REFERENCES "點工人員主檔"("人員ID"),
  "工項"          TEXT,
  "數量"          NUMERIC,
  "小計"          NUMERIC DEFAULT 0,
  "代扣所得稅"    NUMERIC DEFAULT 0,
  "代扣二代健保"  NUMERIC DEFAULT 0,
  "實際支付金額"  NUMERIC DEFAULT 0,
  "備註"          TEXT,
  "更新時間"      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "變更記錄" (
  "id"        SERIAL PRIMARY KEY,
  "時間"      TEXT,
  "操作人"    TEXT,
  "動作"      TEXT,
  "目標分頁"  TEXT,
  "目標ID"    TEXT,
  "備註"      TEXT
);

-- 系統用：資料版本號（前端拿來做「有沒有被別人改過」的簡易判斷）與登入密碼雜湊
CREATE TABLE IF NOT EXISTS "_meta" (
  "key"   TEXT PRIMARY KEY,
  "value" TEXT
);
INSERT INTO "_meta"("key","value") VALUES ('data_version','1')
  ON CONFLICT ("key") DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_contract_project   ON "合約明細"("案場ID");
CREATE INDEX IF NOT EXISTS idx_monthly_project     ON "月度請款"("案場ID");
CREATE INDEX IF NOT EXISTS idx_invoice_project     ON "發票登記"("案場ID");
CREATE INDEX IF NOT EXISTS idx_payment_project     ON "收款登記"("案場ID");
CREATE INDEX IF NOT EXISTS idx_expense_project     ON "支出登記"("案場ID");
