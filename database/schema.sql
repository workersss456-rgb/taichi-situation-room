-- =====================================================================
-- 太綺戰情室 / 案場成本控制中心 — Neon (Postgres) schema
-- 直接沿用試算表分頁的中文欄位名稱，前端幾乎不用改（少改 API 網址即可）
-- 在 Neon 的 SQL Editor 貼上整份執行一次即可
-- =====================================================================

CREATE TABLE IF NOT EXISTS "案場主檔" (
  "案場ID"        TEXT PRIMARY KEY,
  "案場名稱"      TEXT NOT NULL,
  "業主"          TEXT,
  "所屬公司"      TEXT,
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
ALTER TABLE "案場主檔" ADD COLUMN IF NOT EXISTS "所屬公司" TEXT;

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
  "類型"        TEXT,       -- 請款 / 預收 / 折讓 / 扣抵（v5 起；舊資料見 migration_v5）
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

-- 案場預算（成本基準線 / Cost Baseline）：每個案場、每個成本類別設一個預算金額
-- 這是做「預算 vs 實際」成本控制與 EVM 指標的基礎，案場ID 本身就是主鍵（一案場一筆，重複寫入視為更新）
CREATE TABLE IF NOT EXISTS "案場預算" (
  "案場ID"      TEXT PRIMARY KEY REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "材料預算"    NUMERIC DEFAULT 0,
  "發包預算"    NUMERIC DEFAULT 0,
  "點工預算"    NUMERIC DEFAULT 0,
  "其他預算"    NUMERIC DEFAULT 0,
  "預計完工日"  TEXT,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
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
CREATE INDEX IF NOT EXISTS idx_budget_project       ON "案場預算"("案場ID");

-- =====================================================================
-- 戰情室 v3 資料庫升級：預估收入、預估支出、撥款狀態
-- 貼到 Neon SQL Editor 執行即可；可重複執行，不會動到既有資料
-- =====================================================================

-- 1) 預估收入：每案場、每月、現金/支票各一筆，記錄預計入帳日；已完成＝後台勾選「實際完成」
CREATE TABLE IF NOT EXISTS "預估收入" (
  "預估收入ID"  TEXT PRIMARY KEY,
  "案場ID"      TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "年月"        TEXT,                 -- YYYY-MM
  "方式"        TEXT,                 -- 現金 / 支票
  "預估金額"    NUMERIC DEFAULT 0,
  "預計入帳日"  TEXT,
  "已完成"      BOOLEAN DEFAULT false,
  "完成日期"    TEXT,
  "對應收款ID"  TEXT,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);

-- 2) 預估支出：每案場、每月、每類別一筆（材料 / 工數 / 發包 / 折讓 / 其他）
CREATE TABLE IF NOT EXISTS "預估支出" (
  "預估支出ID"  TEXT PRIMARY KEY,
  "案場ID"      TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "年月"        TEXT,
  "類別"        TEXT,
  "預估金額"    NUMERIC DEFAULT 0,
  "備註"        TEXT,
  "更新時間"    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_est_expense ON "預估支出"("案場ID","年月","類別");
CREATE INDEX IF NOT EXISTS idx_est_income_project ON "預估收入"("案場ID","年月");

-- 3) 支出登記：會計備註（後台勾選）— 已撥款(日期) / 尚未撥款 / 撥部份款項
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "撥款狀態" TEXT DEFAULT '尚未撥款';
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "撥款日期" TEXT;
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "已撥金額" NUMERIC DEFAULT 0;

-- 4) 收款登記：對應到預估收入，勾選完成時可以連起來
ALTER TABLE "收款登記" ADD COLUMN IF NOT EXISTS "對應預估收入ID" TEXT;

-- =====================================================================
-- 戰情室 v5：預收訂金（預收扣回）— 與 migration_v5.sql 相同，全新資料庫已含此段
-- =====================================================================
ALTER TABLE "案場主檔" ADD COLUMN IF NOT EXISTS "預收訂金" NUMERIC DEFAULT 0;
ALTER TABLE "收款登記" ADD COLUMN IF NOT EXISTS "收款類型" TEXT;
CREATE TABLE IF NOT EXISTS "預收扣回明細" (
  "扣回ID"    TEXT PRIMARY KEY,
  "案場ID"    TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "年月"      TEXT,
  "發票ID"    TEXT,
  "扣回金額"  NUMERIC DEFAULT 0,
  "備註"      TEXT,
  "更新時間"  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prepay_project ON "預收扣回明細"("案場ID");
ALTER TABLE "發票登記" ADD COLUMN IF NOT EXISTS "發票形式" TEXT;
UPDATE "發票登記" SET "類型" = '請款' WHERE "類型" = '三聯發票';
UPDATE "發票登記" SET "發票形式" = '三聯式發票' WHERE "類型" = '請款' AND "發票形式" IS NULL;

-- =====================================================================
-- 戰情室 v6：工程請款＋預收扣回對應工程請款（與 migration_v6.sql 相同）
-- =====================================================================
CREATE TABLE IF NOT EXISTS "工程請款" (
  "工程請款ID" TEXT PRIMARY KEY,
  "案場ID"     TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "日期"       TEXT,
  "工程款金額" NUMERIC DEFAULT 0,
  "發票ID"     TEXT,
  "備註"       TEXT,
  "更新時間"   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_project ON "工程請款"("案場ID");
ALTER TABLE "預收扣回明細" ADD COLUMN IF NOT EXISTS "工程請款ID" TEXT;

-- ===== v7 增補（與 migration_v7.sql 相同，全新資料庫一次建好）=====
-- =====================================================================
-- 戰情室 v7：保留款／保固金欄位化、工項編碼主檔（WorkerFlow）、
--            案場工項（施工進度）、發包合約控管
-- 可重複執行；請在 migration_v6.sql 之後執行（全新資料庫直接跑 schema.sql 即可）
-- =====================================================================

-- 1) 案場主檔：保固到期日（保固金回收的依據）
ALTER TABLE "案場主檔" ADD COLUMN IF NOT EXISTS "保固到期日" TEXT;

-- 2) 工程請款（應收）：該期扣留的保留款、保固金
ALTER TABLE "工程請款" ADD COLUMN IF NOT EXISTS "保留款" NUMERIC DEFAULT 0;
ALTER TABLE "工程請款" ADD COLUMN IF NOT EXISTS "保固金" NUMERIC DEFAULT 0;

-- 3) 支出登記（應付）：發包扣留的保留款、保固金；掛發包合約；工項代碼
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "保留款" NUMERIC DEFAULT 0;
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "保固金" NUMERIC DEFAULT 0;
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "發包合約ID" TEXT;
ALTER TABLE "支出登記" ADD COLUMN IF NOT EXISTS "工項代碼" TEXT;

-- 4) 工項編碼主檔（代碼格式 TC-WBS-01 / TC-WBS-01-001，待 WorkerFlow 編碼表確認）
CREATE TABLE IF NOT EXISTS "工項主檔" (
  "工項代碼"  TEXT PRIMARY KEY,
  "工項名稱"  TEXT NOT NULL,
  "上層代碼"  TEXT REFERENCES "工項主檔"("工項代碼"),
  "成本分類"  TEXT,            -- 材料 / 工數 / 發包 / 其他
  "單位"      TEXT,
  "備註"      TEXT,
  "更新時間"  TIMESTAMPTZ DEFAULT now()
);

-- 5) 案場工項：每案場各工項的預估金額與完成百分比
CREATE TABLE IF NOT EXISTS "案場工項" (
  "案場工項ID" TEXT PRIMARY KEY,
  "案場ID"     TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "工項代碼"   TEXT REFERENCES "工項主檔"("工項代碼"),
  "預估金額"   NUMERIC DEFAULT 0,
  "完成百分比" NUMERIC DEFAULT 0,
  "更新日期"   TEXT,
  "備註"       TEXT,
  "更新時間"   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proj_item_project ON "案場工項"("案場ID");

-- 6) 發包合約：控管發票・發包的估驗累計不可超過合約金額
CREATE TABLE IF NOT EXISTS "發包合約" (
  "發包合約ID" TEXT PRIMARY KEY,
  "案場ID"     TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "廠商ID"     TEXT REFERENCES "廠商主檔"("廠商ID"),
  "工項代碼"   TEXT REFERENCES "工項主檔"("工項代碼"),
  "合約金額"   NUMERIC DEFAULT 0,
  "保留款比例" NUMERIC DEFAULT 0,
  "合約日期"   TEXT,
  "備註"       TEXT,
  "更新時間"   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_project ON "發包合約"("案場ID");

-- 7) 種子資料：工項四大項（與成本分類對齊；子項待 WorkerFlow 編碼表確認後再匯入）
INSERT INTO "工項主檔" ("工項代碼","工項名稱","上層代碼","成本分類","單位") VALUES
  ('TC-WBS-01','材料設備',NULL,'材料',NULL),
  ('TC-WBS-02','發包工程',NULL,'發包',NULL),
  ('TC-WBS-03','點工人事',NULL,'工數',NULL),
  ('TC-WBS-04','其他費用',NULL,'其他',NULL)
ON CONFLICT ("工項代碼") DO NOTHING;
-- =====================================================================
-- 戰情室 v8：計價單（施工進度）
--   計價明細：每案場的施工項目（對應計價單的期數、內容、比率、單價、合約數量）
--   計價期次：每期每項的本期完成數量與本期金額
-- 施工進度＝Σ(比率 × 累計完成數量÷合約數量)，取代舊的「案場工項」進度來源
-- 可重複執行；請在 migration_v7.sql 之後執行
-- =====================================================================

CREATE TABLE IF NOT EXISTS "計價明細" (
  "明細ID"   TEXT PRIMARY KEY,
  "案場ID"   TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "期數"     TEXT,              -- 計價單期數（00001…）
  "內容"     TEXT,
  "單位"     TEXT,
  "比率"     NUMERIC DEFAULT 0, -- 佔合約總額的百分比（%）
  "單價"     NUMERIC DEFAULT 0, -- = 比率 ÷ 100 × 合約未稅總額
  "合約數量" NUMERIC DEFAULT 1,
  "合約金額" NUMERIC DEFAULT 0, -- = 合約數量 × 單價
  "工項代碼" TEXT REFERENCES "工項主檔"("工項代碼"),
  "排序"     INTEGER DEFAULT 0,
  "備註"     TEXT,
  "更新時間" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_project ON "計價明細"("案場ID");

CREATE TABLE IF NOT EXISTS "計價期次" (
  "期次ID"   TEXT PRIMARY KEY,
  "案場ID"   TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "期次"     TEXT NOT NULL,     -- 例：114/01
  "明細ID"   TEXT REFERENCES "計價明細"("明細ID") ON DELETE CASCADE,
  "本期數量" NUMERIC DEFAULT 0,
  "本期金額" NUMERIC DEFAULT 0, -- = 本期數量 × 單價
  "備註"     TEXT,
  "更新時間" TIMESTAMPTZ DEFAULT now(),
  UNIQUE ("明細ID", "期次")
);
CREATE INDEX IF NOT EXISTS idx_period_project ON "計價期次"("案場ID");
