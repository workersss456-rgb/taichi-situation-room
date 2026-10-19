# 太綺戰情室 — 部署與更新指南

架構：**Render**（Node/Express 後端 + 前端 index.html）＋ **Neon**（Postgres 資料庫）＋ **GitHub**（程式碼版本管理）。
前端與 API 同一個網域，不需要 GitHub Pages，也不需要設定 CORS。

---

## 目錄結構

```
├── index.html                  ← 前端（放在根目錄；server.js 會從這裡讀取）
├── render.yaml                 ← Render 部署設定（rootDir: server）
├── server/
│   ├── server.js               ← 後端 API（Express）
│   ├── package.json
│   └── .env.example            ← 本機測試用環境變數範例（不要上傳 .env）
├── database/
│   ├── schema.sql              ← 全新資料庫：完整建表（含 v3）
│   ├── migration_v3.sql        ← 既有資料庫：只加 v3 的表與欄位，可重複執行
│   └── seed_current.sql        ← 目前資料（廠商、支出、發票、請款、變更記錄）；可重複執行
├── scripts/
│   └── migrate_current_data.py ← 舊資料搬移用，日常不需要
└── .gitignore                  ← 會排除 .env 與 node_modules
```

---

## 一、Neon（資料庫）

- **全新資料庫**：SQL Editor 貼上 `database/schema.sql` 整份執行。再貼 `database/seed_current.sql` 執行（選用，要有目前的廠商與支出資料才需要）。
- **既有資料庫（已有 v2 資料）**：只執行 `database/migration_v3.sql`。不要重跑 schema.sql 以外的舊版檔案。
- 複製 Dashboard → Connection string（選 **Pooled connection**），給 Render 用。

## 二、GitHub（程式碼）

用 GitHub Desktop：
1. 把要更新的檔案覆蓋進 repo 資料夾（見上方目錄結構）。
2. 確認變更清單裡**沒有 `.env`**。
3. 填 Summary → **Commit to main** → **Push origin**。

## 三、Render（後端＋前端）

首次建立：New → Web Service → 選此 repo。Root Directory 填 `server`，Build Command `npm install`，Start Command `npm start`（`render.yaml` 已寫好，也可以直接用 Blueprint）。

**Environment 頁籤**設定以下變數（都不放在 repo 裡）：

| 變數 | 說明 |
|---|---|
| `DATABASE_URL` | Neon 的 Pooled connection 字串 |
| `JWT_SECRET` | 一長串亂碼，簽發登入 token 用 |
| `ADMIN_PASSWORD` | 登入畫面要輸入的管理密碼 |
| `ALLOWED_ORIGIN` | 前端與 API 同網域，可留 `*` 或填 Render 網址 |

推送後 Render 會自動部署（Events 頁籤可看進度）。若沒有自動部署，Manual Deploy → Deploy latest commit。

## 四、驗證

1. `https://taichi-situation-room.onrender.com/api/health` → 應顯示「太綺戰情室 API 運作中」。
2. 打開首頁，按 **Ctrl+F5**（Mac：Cmd+Shift+R）強制重新整理。
3. 依序測試：儀表板 KPI、案場詳情的預估收支、支出的撥款狀態、📤 匯出 Excel、📄 下載匯入模板。

免費方案閒置後第一次開啟會較慢（冷啟動），等幾十秒即可。

---

## ⚠️ 安全注意

- **`.env` 不可上傳 GitHub。** 若已經推送過，請在 Neon 重設資料庫密碼、換一組 `JWT_SECRET` 與 `ADMIN_PASSWORD`，並更新 Render 的環境變數。
- 目前系統為免登入（內部系統），網址公開的話任何人都能讀寫資料。建議之後加一組共用 PIN。
