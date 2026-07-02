const SPREADSHEET_ID = '19kPC7jyRhmWXzy6gdkVQQTXUvwwdlPvlRzy15JtPvnA';
const SHEET_NAME = '表單回應 1';

// 初始進入點：渲染網頁介面
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('自然科課程藥品/物品申請採購管理系統')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 取得當前使用者 Email
function getCurrentUserEmail() {
  try {
    return Session.getActiveUser().getEmail();
  } catch(e) {
    return "";
  }
}

// 處理表單提交（含圖片解碼與儲存）
function submitApplication(formData) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    
    // 若工作表不存在則建立，並初始化標頭
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '時間戳記', '物品/藥品中文名稱', '藥品英文名稱(含化學式，分子量)或物品名稱', 
        '所需數量', '物品分類/化學藥品狀態', '藥品濃度(液態)', 
        '課程使用時間', '請勾選所需科別', '申請人電子郵件地址', 
        '物品/藥品照片', '是否請購'
      ]);
    }
    
    var photoUrl = '無照片';
    
    // 處理圖片上傳
    if (formData.photoBase64 && formData.photoName) {
      var splitData = formData.photoBase64.split(',');
      var contentType = splitData[0].split(':')[1].split(';')[0];
      var base64Data = splitData[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, formData.photoName);
      
      // 建立檔案於雲端硬碟根目錄（實務上可指定 Folder ID）
      var file = DriveApp.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = file.getUrl();
    }
    
    // 寫入資料列
    sheet.appendRow([
      new Date(),
      formData.chineseName,
      formData.englishName,
      formData.quantity,
      formData.category,
      formData.concentration || '無',
      formData.usageTime,
      formData.subject,
      formData.email,
      photoUrl,
      '未請購' // 預設初始狀態
    ]);
    
    return { success: true, message: '資料與照片提交成功！' };
  } catch (error) {
    return { success: false, message: '後端錯誤: ' + error.toString() };
  }
}

// 供管理者介面讀取所有資料
function getAdminData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // 只有標頭或空表
    
    var headers = data[0];
    var rows = data.slice(1);
    
    return rows.map(function(row, index) {
      return {
        rowNumber: index + 2, // 實際在試算表中的列號（用於更新狀態）
        timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), "GMT+8", "yyyy-MM-dd HH:mm") : "",
        chineseName: row[1],
        englishName: row[2],
        quantity: row[3],
        category: row[4],
        concentration: row[5],
        usageTime: row[6],
        subject: row[7],
        email: row[8],
        photoUrl: row[9],
        status: row[10]
      };
    });
  } catch (error) {
    return [];
  }
}

// 更新特定的請購狀態
function updateProcurementStatus(rowNumber, newStatus) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    // 「是否請購」位於第 11 欄 (K欄)
    sheet.getRange(rowNumber, 11).setValue(newStatus);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}