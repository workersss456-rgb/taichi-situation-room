# 太綺戰情室 — 部署與資料匯入指南

把原本「Google Apps Script + Google Sheets」的架構，換成 **GitHub Pages（前端）+ Render（後端 API）+ Neon（Postgres 資料庫）**。

---

## 目錄結構

```
taichi/
├── database/
│   ├── schema.sql                       ← 資料表結構，Neon 上先執行這個
│   ├── seed_current.sql                 ← 目前新版資料庫裡「已經有」的資料（廠商、支出、發票…）
│   └── seed_legacy_PENDING_REVIEW.sql   ← 舊戰情表的 15 個案場歷史資料，⚠️需要你確認過才能執行
├── server/
│   ├── server.js                        ← 後端 API（Express）
│   ├── package.json
│   └── .env.example                     ← 環境變數範例
├── render.yaml                          ← Render 一鍵部署設定（選用）
└── frontend/
    └── index.html                       ← 前端頁面（改好顏色/手機版/新的登入方式）
```

---

## 第一步：Neon（資料庫）

1. 到 [neon.tech](https://neon.tech) 註冊、建立一個新專案（免費方案就夠用）。
2. 進入專案的 **SQL Editor**，貼上 `database/schema.sql` 整份內容並執行。
3. 接著貼上 `database/seed_current.sql` 整份內容並執行 — 這會把廠商主檔（50 筆）、支出登記（13 筆）、發票登記、月度請款、變更記錄都匯入，並且先幫 P0001~P0008 建立**佔位案場**（因為原始檔案裡「案場主檔」那個分頁其實是空的，這 8 個案場目前完全沒有名稱/業主/金額資料，見下方「⚠️ 需要你確認的事」）。
4. 舊版戰情表的 15 個案場歷史資料，**先不要**急著執行 `seed_legacy_PENDING_REVIEW.sql`，看完下面的說明再決定。
5. 回到 Dashboard → **Connection string**，選 "Pooled connection"，複製起來，等一下 Render 會用到（長得像 `postgresql://user:pass@ep-xxxx.neon.tech/neondb?sslmode=require`）。

## 第二步：Render（後端 API）

1. 把 `server/` 這個資料夾（連同 `package.json`、`server.js`）放進一個 GitHub repo（可以跟前端同一個 repo，也可以分開）。
2. 到 [render.com](https://render.com) → New → Web Service → 選剛剛的 repo。
   - Root Directory：`server`（如果 server 資料夾不是放在 repo 根目錄）
   - Build Command：`npm install`
   - Start Command：`npm start`
3. 在 Render 的 Environment 頁籤設定這幾個變數（參考 `server/.env.example`）：
   - `DATABASE_URL`：上一步從 Neon 複製的連線字串
   - `JWT_SECRET`：隨便一串夠長的亂碼
   - `ADMIN_PASSWORD`：你自己要用來登入系統的密碼
   - `ALLOWED_ORIGIN`：你的 GitHub Pages 網址，例如 `https://workersss456-rgb.github.io`
4. 部署完成後，Render 會給你一個網址，例如 `https://taichi-situation-room-api.onrender.com`。打開它，看到「太綺戰情室 API 運作中」就表示成功了。

> Render 免費方案沒有流量會自動休眠，第一次打開網站時 API 可能要等 30 秒~1 分鐘才會醒來，是正常的。

## 第三步：GitHub Pages（前端）

1. 打開 `frontend/index.html`，找到最上面這一行：
   ```js
   const API_BASE_URL = "https://YOUR-RENDER-SERVICE.onrender.com";
   ```
   換成你在第二步拿到的 Render 網址（結尾不要加斜線）。
2. 把這個檔案覆蓋到你現有的 GitHub Pages repo（`workersss456-rgb.github.io/taichi-situation-room/`）裡對應的檔案，commit、push。
3. 打開網站，右上角輸入 `ADMIN_PASSWORD` 登入，就可以開始編輯資料了。

---

## ⚠️ 需要你確認的事：P0001~P0008 到底是不是舊的 15 個案場？

檢查資料後發現一件需要你決定的事，直接猜的話有可能讓營收/支出被重複計算，所以先跟你確認：

- 原始 Excel 裡有兩批案場資料：
  1. **新版資料**：目前已經在用的 8 個案場（`P0001`~`P0008`），已經有支出登記、發票登記、月度請款的紀錄，但「案場主檔」分頁本身是空的 — 也就是完全沒有存到這 8 個案場的名稱、業主、合約金額！
  2. **舊版戰情表資料**：`案場` / `月度紀錄` / `追加減` 這三個分頁，是另一套小寫 `p1`~`p15` 編號、共 15 個案場的完整歷史（名稱、業主、合約金額、每月請款/實支）。

- 比對數字後發現，`P0001` 的資料（2025-11 預估請款 2,109,669、發票 1,582,252、項目「基礎完成 筏基 10%」）跟舊資料裡 `p3`「11404鎮曜營造-環中路」（合約 21,096,688，正好是 2,109,669 的 10 倍，115/01~04 每月實際請款也都是 1,582,252）**高度吻合，很可能是同一個案場**，只是重新用新系統輸入了一次。

- 但其餘 `P0002`~`P0008` 對不對得上舊資料裡的哪個 `p1`~`p15`，光看資料看不出來（沒有共同的關鍵字/金額可以比對）。

**這代表如果我直接把 15 個舊案場當成全新案場匯入，`P0001` 跟 `p3` 的營收/支出很可能會被算兩次。**

我準備了 `database/seed_legacy_PENDING_REVIEW.sql`，把舊的 15 個案場先暫時編成 `P1001`~`P1015`（不會跟現有的撞號），對照表寫在檔案最上面。麻煩你看過之後告訴我：

1. 這 15 個舊案場，跟現在的 `P0001`~`P0008` 有哪幾個其實是「同一個案場」？（例如：`p3` = `P0001`）
2. 剩下對不上、或本來就已經結案的案場，要「當作新案場整批匯入」還是「不用匯入、只是歷史備查就好」？
3. `P0001`~`P0008` 目前完全沒有名稱/業主/合約金額（我先放了「⚠️ 請填寫案場名稱」的佔位資料），這 8 筆的正確資料能不能提供？

你確認後，我可以幫你把 `seed_legacy_PENDING_REVIEW.sql` 修改成正確版本（該合併的合併、該調整 ID 的調整），再一次執行到 Neon 就完成了，之後也能直接在網頁上把佔位名稱改掉。

---

## 這次順便做的優化

- **顏色**：原本是深色（近黑）底、對比不足，已經整套換成淺色主題（白色卡片 + 淺灰底 + 加深文字對比），閱讀性應該有明顯改善。
- **手機版**：加了響應式排版 —— 儀表板卡片改成兩欄、彈出視窗改成貼底全寬、頁籤/表格可以左右滑動、輸入框字級固定 16px（避免 iPhone 自動放大畫面跳版）。
- **登入方式**：因為前端現在是純靜態網頁（GitHub Pages），沒辦法再用 Google Apps Script 那種「伺服器端」的 Google 登入流程，所以改成「單一管理密碼」登入（存在 Render 的環境變數，不會外流到程式碼或網頁原始碼），未登入時一樣是唯讀、身分證字號一樣會被後端遮蔽。之後如果想恢復 Google 帳號登入也可以，只是需要另外申請一組指向 Render 網址的 OAuth 用戶端，會比較花工。

## 之後如果要繼續開發

- 資料庫欄位直接沿用原本試算表的中文欄位名稱，前端程式碼幾乎不用改動 calc 函式；新增欄位時記得 `database/schema.sql` 跟 `server/server.js` 裡的 `TABLES` 設定要一起改。
- `server.js` 用簡易的「資料版本號」做防止覆蓋的機制（跟原本 GAS 版本邏輯一樣），單一管理者使用基本上夠用；如果之後有多人同時編輯的需求，會建議做成逐欄位的樂觀鎖定或即時同步。
