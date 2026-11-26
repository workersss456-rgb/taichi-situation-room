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
