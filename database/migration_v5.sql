-- =====================================================================
-- 戰情室 v5：預收訂金（預收扣回）＋發票形式（電子／三聯式）
-- 既有資料庫執行一次即可；可重複執行，不會動到既有資料
-- 口徑：預收收款不計收入；每期請款以「扣到用完」扣回預收；扣回前不收現金
-- =====================================================================

-- 1) 案場主檔：預收訂金總額（0 或空白＝無預收）
ALTER TABLE "案場主檔" ADD COLUMN IF NOT EXISTS "預收訂金" NUMERIC DEFAULT 0;

-- 2) 收款登記：收款類型（工程款／預收訂金），空白視為工程款
ALTER TABLE "收款登記" ADD COLUMN IF NOT EXISTS "收款類型" TEXT;

-- 3) 預收扣回明細：每期請款從預收扣回的金額（一期一筆，可對應到請款發票）
CREATE TABLE IF NOT EXISTS "預收扣回明細" (
  "扣回ID"    TEXT PRIMARY KEY,
  "案場ID"    TEXT REFERENCES "案場主檔"("案場ID") ON DELETE CASCADE,
  "年月"      TEXT,          -- YYYY-MM
  "發票ID"    TEXT,          -- 對應的請款發票（可空）
  "扣回金額"  NUMERIC DEFAULT 0,
  "備註"      TEXT,
  "更新時間"  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prepay_project ON "預收扣回明細"("案場ID");

-- 4) 發票登記：類型改為 請款／預收／折讓／扣抵；原「三聯發票」轉為「請款」＋發票形式「三聯式發票」
ALTER TABLE "發票登記" ADD COLUMN IF NOT EXISTS "發票形式" TEXT;   -- 電子發票 / 三聯式發票
UPDATE "發票登記" SET "類型" = '請款' WHERE "類型" = '三聯發票';
UPDATE "發票登記" SET "發票形式" = '三聯式發票' WHERE "類型" = '請款' AND "發票形式" IS NULL;
