# 前端 JavaScript 架構分拆與模組化計畫 (時序規劃版)

> **目標**：為了確保系統穩定，避免一次性大幅更動導致網站崩潰。我們將分拆工作依照**「風險度從低到高」**劃分為三個階段。每個階段完成後，您都可以進行測試，確認無誤後再進入下一階段。

---

## 1. 核心分拆架構回顧

1. **保留引擎**：保留 `js-ui-widgets.html` 作為底層渲染引擎。
2. **角色隔離**：將原本混雜在 `js-admin.html` 裡的清單邏輯，正式拆分為 `js-list-admin.html` 與 `js-list-user.html`。
3. **功能剝離**：將圖片處理、系統設定、API 通訊抽離成獨立檔案。

---

## 2. 分拆時序與風險評估 (Phased Execution Plan)

### 🟢 階段一：低風險 - 獨立附屬功能剝離
> **說明**：將與核心表單、清單無關的附屬功能移出。這些功能相對獨立，移出後只要確保 HTML 載入順序正確，幾乎不會影響主系統。

* **Step 1: 建立 `js-settings.html`**
  * 從 `js-admin.html` 中剪下「系統參數設定 (`loadSystemSettings`, `_saveSettings`...)」與「Logo 上傳 (`showLogoPreview`, `handleLogoUpload`)」邏輯。
* **Step 2: 建立 `js-image-manager.html`**
  * 從 `js-forms.html` 移出 `fileToBase64`、`initImageDropZone`。
  * 從 `js-ui-utility.html` 移出圖片燈箱 (`openImageModal`, `getDriveImageUrl`)。
  * 將這些功能整合為統一的圖片管理器。
* **Step 3: 更新前端載入檔 (Index.html)**
  * 將這兩個新檔案加入載入清單。
  * *測試點：系統設定是否能正常存檔？各處的圖片是否能正常上傳與預覽？*

### 🟡 階段二：中風險 - 角色清單分家與 API 抽離
> **說明**：這是本次重構的核心。將 `js-admin.html` 打破並依據使用者角色重建。會動到核心的資料流，但邏輯本身保持不變。

* **Step 4: 建立 `js-api.html`**
  * 從 `js-core.html` 中抽離 `window.callGas` 與 `SystemCache`，專責管理與後端通訊。
* **Step 5: 建立 `js-list-user.html`**
  * 從 `js-admin.html` 中剪下 `renderUserDatalist` 與使用者取消申請 (`cancelSelectedRequests`) 相關邏輯。
* **Step 6: 建立 `js-list-admin.html`**
  * 從 `js-admin.html` 中剪下 `renderAdminDatalist`、狀態更新 (`updateStatus`, `batchUpdateAdminRequests`) 與 Excel 匯出 (`exportAdminDataToExcel`) 邏輯。
* **Step 7: 刪除 `js-admin.html` 並更新載入檔**
  * *測試點：一般使用者登入，是否能看到自己的申請清單並取消？管理員登入，是否能批次審核與匯出？*

### 🔴 階段三：高風險 - 路由整理與設定檔整合
> **說明**：牽涉到整個應用程式的畫面切換與狀態流轉。一旦出錯，可能會導致整個畫面空白或按鈕點擊無效。

* **Step 8: 重構為 `js-router.html`**
  * 將原 `js-switch.html` 重新命名並整理。這負責所有「隱藏/顯示」的 DOM 操作與權限 UI 切換。
* **Step 9: 整理 `js-forms.html` 與 `js-config.html`**
  * 確保 `js-forms.html` 只剩下純粹的表單送出邏輯 (`handleGenericSubmit`)。
  * 確保 `js-config.html` 包含了所有表格欄位、下拉選單的變數設定。
* **Step 10: 最終全機測試**
  * *測試點：權限切換是否正常？(登入/登出、學生/教師/管理員)*

---

## 3. User Review Required

> [!IMPORTANT]
> 這樣的漸進式（Low -> High Risk）分拆時序，可以讓您在每個階段完成後都有機會停下來測試，避免網站一次性大改而陷入抓漏地獄。

**Open Questions:**
這個**「階段一 -> 階段二 -> 階段三」**的實作順序是否符合您的節奏？
如果沒有問題，我們現在就可以為您產生 `task.md` 待辦清單，並立刻開始執行 **[階段一：獨立附屬功能剝離]** 的程式碼搬家作業！
