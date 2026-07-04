# 🧪 自然科課程藥品/物品申請採購管理系統
(Science Procurement Management System)

這是一個基於 **Google Apps Script (GAS)** 開發的輕量級網頁應用程式，專為學校（以 `@fhsh.khc.edu.tw` 網域為例）設計。系統提供全前端 SPA 介面，支援教師申請課程所需之藥品與實驗物品，並具備管理者後台審核功能。

## ✨ 核心特色

- **半開放式架構**：首頁開放瀏覽，使用者需登入後方可提交申請或檢視紀錄。
- **自建 OAuth2 安全登入**：突破 GAS 「執行身分：我」的限制，實作自訂的 Google OAuth2 流程，安全取得使用者信箱並發放 Cache Session Token，兼顧跨域存取與個資安全。
- **無縫背景預載入 (Background Preloading)**：登入後自動於背景獲取資料表數據，實現分頁「0 秒瞬間切換」的極致流暢體驗。
- **豐富的前端互動體驗 (Tailwind CSS)**：支援圖片拖曳/貼上上傳、客製化 Modal 對話框、自訂浮動提示視窗 (Tooltip)，並內建防抖 (Debounce) 與即時資料篩選。
- **高併發安全機制**：後端寫入試算表時使用 `LockService` 避免多人同時提交造成的資料覆蓋衝突。
- **一鍵匯出 Excel**：管理者後台整合 SheetJS 模組，可依篩選條件一鍵匯出採購清單。

---

## 📂 系統架構與檔案說明

本專案主要包含兩個核心檔案：

### `Code.js` (後端邏輯與 API 服務)
負責處理所有的後端商業邏輯、Google 服務整合與資料庫（試算表）互動。
- **OAuth2 驗證 (`processOAuthCallback`)**：處理授權碼交換、讀取 UserInfo 並寫入 `CacheService` (6 小時時效)。
- **路由分配 (`doGet`)**：負責渲染首頁，或是處理 Google 授權跳轉。
- **資料庫存取 (`submitApplication`, `getSheetData`, `getAdminData`, `updateProcurementStatus`)**：封裝了寫入表單、撈取歷史資料以及更新審核狀態的方法。
- **權限控制**：內建管理員清單 (`ADMIN_EMAILS`) 與阻擋名單規則 (`BLOCKED_ACCOUNT_RULES`，如阻擋學生帳號登入)。
- **通知功能**：結合 `MailApp` 發送申請成功的自動通知信。

### `Index.html` (前端使用者介面 SPA)
這是一個包含 HTML 結構、Tailwind CSS 樣式及所有 JavaScript 邏輯的單頁式應用程式。
- **三大視圖切換**：
  - **申請表單 (`view-apply`)**：提供詳細的採購表單，動態切換欄位（如液態藥品濃度）。
  - **個人申請紀錄 (`view-user-list`)**：依使用者信箱過濾個人的申請歷史，並提供取消功能。
  - **管理者後台 (`view-admin`)**：管理員專屬介面，可檢視所有採購單、更改狀態（已請購/不通過）、輸入採購金額並匯出 Excel。
- **效能優化設計**：
  - **DOM 快取**：利用 `initDOM()` 預先快取大量 DOM 元素，減少 `document.getElementById` 開銷。
  - **事件委派 (Event Delegation)**：在資料表中透過父層監聽滑鼠事件來顯示 Tooltip，節省大量記憶體。
  - **前端路由淨化**：登入跳轉後，運用 `history.replaceState` 自動抹除網址列上的 Token 參數，確保安全。

---

## 🛠️ 開發與部署指南

### 1. 準備工作 (GCP 憑證設定)
詳情請見目錄下的 `OAuth2_GuideLine.md`。您必須先前往 Google Cloud Console 申請 **OAuth 2.0 用戶端 ID**，並取得 `CLIENT_ID` 與 `CLIENT_SECRET`。

### 2. 環境變數設定
進入 Apps Script 編輯器：
1. 點擊 **專案設定 (齒輪圖示)**。
2. 滑至底部的 **指令碼屬性**，新增以下兩個屬性：
   - `CLIENT_ID`: 您的 OAuth 用戶端 ID
   - `CLIENT_SECRET`: 您的 OAuth 用戶端密碼

### 3. 配置參數 (於 `Code.js`)
您可依需求修改 `Code.js` 頂部的全域變數：
- `SPREADSHEET_ID`: 作為資料庫的 Google 試算表 ID。
- `ADMIN_EMAILS`: 允許進入管理者後台的電子信箱陣列。
- `getAppUrl()`: 必須回傳您**正式發布的 Web App URL**。

### 4. 系統發布
1. 點擊右上方 **部署** > **管理部署作業**（或新增部署作業）。
2. 網頁應用程式設定：
   - **執行身分**：`我 (開發者)`
   - **誰可以存取**：`所有人`
3. 取得網址後，務必將此網址更新至：
   - `Code.js` 的 `getAppUrl()`。
   - GCP Console 的「已授權的重新導向 URI」。

---

## 📝 授權與依賴套件

- **前端樣式**：[Tailwind CSS (CDN)](https://tailwindcss.com/)
- **Excel 匯出**：[SheetJS (xlsx.full.min.js)](https://sheetjs.com/)
- **後端服務**：Google Apps Script 內建之 `SpreadsheetApp`, `DriveApp`, `MailApp`, `UrlFetchApp`, `CacheService`, `LockService`。
