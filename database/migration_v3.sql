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
