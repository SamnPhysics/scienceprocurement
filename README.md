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
- **認證與授權機制**：
  - **`processOAuthCallback` / `verifySessionToken` / `getAuthStatus` / `logoutOAuth`**：處理 OAuth2 授權碼交換、生成與驗證 `CacheService` 裡的 Session Token (6 小時時效)，並支援登出機制。
- **路由分配與渲染**：
  - **`doGet` / `include`**：負責渲染首頁 HTML，載入外部樣板，並處理 Google 授權跳轉邏輯。
- **表單與資料存取**：
  - **`submitApplication` / `submitEquipApplication` / `submitEquipBorrowApplication` / `batchSubmitApplication`**：根據不同表單需求封裝寫入試算表的方法，並支援 Excel 批次匯入的多筆提交。
  - **`getSheetData` / `getAdminData` / `getUserData`**：針對不同權限層級（訪客/管理員/一般使用者）撈取並過濾歷史資料。
- **管理者與系統設定功能**：
  - **`updateProcurementStatus` / `batchUpdateProcurementStatus`**：提供單筆與批次更新採購與審核狀態。
  - **`deleteUserRequests`**：允許使用者或管理員刪除特定申請紀錄。
  - **`getSystemSettings` / `saveSystemSettings`**：讀寫 `PropertiesService` 的系統參數（環境變數動態管理）。
- **實驗室預約系統**：
  - **`getLabData` / `submitLabBooking` / `cancelLabBooking`**：處理實驗室排程的讀取、預約寫入及單筆/系列取消功能。
- **檔案處理與整合服務**：
  - **`uploadLogoImage` / `saveBase64ImageToDrive_`**：處理前端 Base64 圖片上傳至 Google Drive 的邏輯。
  - **權限控制**：透過 `isAdminUser` 與 `isBlockedUser` 等判斷管理員權限與阻擋黑名單。

### 前端模組化 SPA 架構 (`Index.html`、`IndexComponent*.html`、`IndexTab-*.html` 與 `js-*.html`)
前端採用 Tailwind CSS 與原生 JavaScript，並拆分為多個模組以利維護：

**1. 主框架與 UI 元件 (`Index*.html`)**
- **`Index.html`**：負責定義主框架版面、載入外部套件 (Tailwind, SheetJS, FontAwesome) 以及所有子模組。
- **`IndexComponentDatalist.html`**：共用資料清單 (Datalist) 元件，包含篩選工具列與表格容器。
- **`IndexComponentLabTemplates.html`**：實驗室預約系統的前端 DOM 渲染用 HTML 樣板 (`<template>`)。
- **`IndexComponentPrintSchedule.html`**：實驗室週課表 A4 列印專用 HTML 樣板。
- **`IndexComponentUserMenu.html`**：使用者右上角下拉選單元件 (個人紀錄、管理後台、登出等)。

**2. 各大功能分頁視圖 (`IndexTab-*.html`)**
- **`IndexTab-chem.html`**：藥品/耗材採購申請表單視圖，包含 Excel 匯入功能。
- **`IndexTab-equip.html`**：科學/實驗設備需求申請表單視圖。
- **`IndexTab-equipBorrow.html`**：教學實驗設備借用申請表單視圖。
- **`IndexTab-lab.html`**：實驗室借用/使用預約表單視圖。
- **`IndexTab-SystSetting.html`**：系統參數設定分頁視圖 (管理員專用)。

**3. 前端邏輯模組 (`js-*.html`)**
- **`js-core.html`**：核心工具與全域初始化，包含 Session Token、防抖 (debounce)、DOM 快取與全域變數宣告。
- **`js-auth.html`**：認證與登入邏輯、畫面路由 (視圖切換)。
- **`js-config.html`**：系統常數與設定檔 (如下拉選項、表單欄位設定、Excel 匯出設定等)。
- **`js-ui-widgets.html`**：UI 元件類別 (PageNav 分頁、DataTableManager 資料表管理、共用互動視窗如 alert/confirm 覆寫)。
- **`js-forms.html`**：共用表單提交邏輯、驗證機制與圖片拖曳上傳處理。
- **`js-admin.html`**：管理員功能模組 (批次更新狀態、資料匯出、系統設定儲存)。
- **`js-lab-core.html`**：實驗室預約模組的核心常數、狀態管理與篩選工具。
- **`js-lab-modal.html`**：實驗室預約模組的對話框 (Modal) 控制 (包含日明細、週課表預覽、預約表單)。
- **`js-lab-render.html`**：實驗室預約模組的畫面渲染邏輯 (時間軸、列表渲染等)。

---

## 🛠️ 開發與部署指南

### 1. 準備工作 (GCP 憑證設定)
詳情請見目錄下的 `OAuth2_GuideLine.md`。您必須先前往 Google Cloud Console 申請 **OAuth 2.0 用戶端 ID**，並取得 `CLIENT_ID` 與 `CLIENT_SECRET`。

### 2. 環境變數與配置設定 (PropertiesService)
本專案的機密資訊（如試算表 ID）與學校專屬文字已全面抽離至 **伺服器屬性 (PropertiesService)** 中，未來轉移專案時不需在程式碼內尋找並修改寫死的文字。

**快速設定步驟：**
1. 準備好您的 `CLIENT_ID` 與 `CLIENT_SECRET` (來自 GCP OAuth 2.0 設定，詳見 `OAuth2_GuideLine.md`)。
2. 開啟 `Code.js`，滑到檔案最下方的 `setupProperties()` 函式。
3. 依照註解說明，填入您的環境變數與特定文字：
   - `SPREADSHEET_ID`: 存放表單資料的 Google 試算表 ID。
   - `FOLDER_ID`: 存放使用者上傳圖片的 Google Drive 資料夾 ID。
   - `LOGO_ID`: 前端介面左上角的 Logo 圖片 (Google Drive 檔案 ID)。
   - `WEB_APP_URL`: 您**正式發布的 Web App URL**。
   - `ADMIN_EMAILS`: 管理員的 Email 列表 (逗號分隔)。
   - `ALLOWED_DOMAIN`: 限定登入的組織/學校網域。
   - `SCHOOL_NAME`, `SYSTEM_TITLE` ...等前端渲染文字。
   - `CLIENT_ID` 與 `CLIENT_SECRET`。
4. 在編輯器上方的下拉選單中，選擇 `setupProperties` 函式並按下 **執行**。
5. (選用) 執行後，可點擊左側 **專案設定 (齒輪圖示)** > 滑至底部的 **指令碼屬性** 檢查所有已寫入的環境變數。

### 3. 系統發布
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
