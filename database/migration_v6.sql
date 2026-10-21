-- =====================================================================
-- 戰情室 v6：工程請款（權責收入來源，不需要先開發票）＋預收扣回改對應工程請款
-- 可重複執行；請在 migration_v5.sql 之後執行
-- =====================================================================

-- 1) 工程請款：每期實際完成的工程款（含稅），權責收入與累計已請款以此為準
CREATE TABLE IF NOT EXISTS "工程請款" (
  "工程請款ID" TEXT PRIMARY KEY,
  "案場ID"     TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "日期"       TEXT,
  "工程款金額" NUMERIC DEFAULT 0,
  "發票ID"     TEXT,            -- 對應的請款發票（可空，未開發票就留空）
  "備註"       TEXT,
  "更新時間"   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_project ON "工程請款"("案場ID");

-- 2) 預收扣回明細：改為對應到某一筆工程請款
ALTER TABLE "預收扣回明細" ADD COLUMN IF NOT EXISTS "工程請款ID" TEXT;
