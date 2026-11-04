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
