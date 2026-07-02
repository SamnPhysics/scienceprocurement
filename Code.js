const SPREADSHEET_ID = '19kPC7jyRhmWXzy6gdkVQQTXUvwwdlPvlRzy15JtPvnA';
const SHEET_NAME = '表單回應 1';
const ADMIN_EMAILS = ['5501@fhsh.khc.edu.tw', '5502@fhsh.khc.edu.tw'];

function isAdminUser(email) {
  if (!email) return false;
  return ADMIN_EMAILS.indexOf(email.toLowerCase()) !== -1;
}

// 初始進入點：渲染網頁介面
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('自然科課程藥品/物品申請採購管理系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ====== OAuth2 授權服務 ======

// 建立專屬於該使用者的 CachePropertyStore
function getCachePropertyStore(sessionId) {
  return {
    getProperty: function (key) {
      return CacheService.getScriptCache().get(key + '_' + sessionId);
    },
    setProperty: function (key, value) {
      // 儲存 6 小時
      CacheService.getScriptCache().put(key + '_' + sessionId, value, 21600);
    },
    deleteProperty: function (key) {
      CacheService.getScriptCache().remove(key + '_' + sessionId);
    }
  };
}

function getOAuthService(sessionId) {
  var props = PropertiesService.getScriptProperties();
  return OAuth2.createService('GoogleAuth_' + sessionId)
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(props.getProperty('CLIENT_ID') || '')
    .setClientSecret(props.getProperty('CLIENT_SECRET') || '')
    .setCallbackFunction('authCallback')
    // 使用專屬的 Store，避免「任何人存取」模式下不同瀏覽器/使用者互相覆蓋 Token
    .setPropertyStore(getCachePropertyStore(sessionId))
    .setCache(CacheService.getScriptCache())
    .setLock(LockService.getScriptLock())
    .setScope('https://www.googleapis.com/auth/userinfo.email')
    .setParam('access_type', 'offline')
    .setParam('hd', 'fhsh.khc.edu.tw');
}

function authCallback(request) {
  var stateToken = request.parameter.state;
  var sessionId = CacheService.getScriptCache().get('state_session_' + stateToken);

  if (!sessionId) {
    return HtmlService.createHtmlOutput('授權狀態已失效或逾時，請關閉視窗並重新整理原頁面再試一次。');
  }

  var service = getOAuthService(sessionId);
  var authorized = service.handleCallback(request);
  if (authorized) {
    // 使用手動設定的 APP_URL，避免 ScriptApp.getService().getUrl() 返回舊版錯誤格式網址
    var appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL') || ScriptApp.getService().getUrl();
    return HtmlService.createHtmlOutput(
      '<div style="font-family: sans-serif; padding: 2rem; text-align: center;">' +
      '<h2>登入授權成功！</h2>' +
      '<p>系統將在 1 秒後自動為您重新導向...</p>' +
      '<p style="margin-top: 1rem; font-size: 0.9em; color: #666;">若沒有自動跳轉，請 <a id="manual-link" href="' + appUrl + '" target="_top" style="color: #2563eb; text-decoration: underline;">點擊此處回到系統</a>。</p>' +
      '<script>' +
      '  setTimeout(function() { window.top.location.href = "' + appUrl + '"; }, 1000);' +
      '</script>' +
      '</div>'
    );
  } else {
    return HtmlService.createHtmlOutput('授權失敗，請關閉視窗並重新嘗試。');
  }
}

function getLoginUrl(sessionId) {
  var service = getOAuthService(sessionId);
  var authUrl = service.getAuthorizationUrl();

  // 將 state 與 sessionId 綁定，以便 callback 時能找回正確的 service
  var stateMatch = authUrl.match(/state=([^&]+)/);
  if (stateMatch && stateMatch[1]) {
    CacheService.getScriptCache().put('state_session_' + decodeURIComponent(stateMatch[1]), sessionId, 1800); // 保存30分鐘
  }

  return authUrl;
}

function logoutOAuth(sessionId) {
  if (sessionId) {
    getOAuthService(sessionId).reset();
  }
  // 使用手動設定的 APP_URL，避免 ScriptApp.getService().getUrl() 返回舊版錯誤格式網址
  return PropertiesService.getScriptProperties().getProperty('APP_URL') || ScriptApp.getService().getUrl();
}

function getOAuthEmail(sessionId) {
  if (!sessionId) return "";
  var service = getOAuthService(sessionId);
  if (service.hasAccess()) {
    try {
      var url = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
      var response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + service.getAccessToken()
        }
      });
      var profile = JSON.parse(response.getContentText());
      return profile.email;
    } catch (e) {
      return "";
    }
  }
  return "";
}

// 供前端檢查權限與登入狀態的端點
function getAuthStatus(sessionId) {
  if (!sessionId) {
    return { loggedIn: false, email: "", role: "guest", loginUrl: "" };
  }
  var email = getOAuthEmail(sessionId);
  if (!email) {
    return { loggedIn: false, email: "", role: "guest", loginUrl: getLoginUrl(sessionId) };
  }

  if (!email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
    return { loggedIn: true, email: email, role: "invalid", message: "非學校網域帳號" };
  }

  var role = isAdminUser(email) ? "admin" : "user";
  return { loggedIn: true, email: email, role: role };
}


// 處理表單提交（含圖片解碼與儲存）
function submitApplication(formData, sessionId) {
  try {
    var email = getOAuthEmail(sessionId);
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@fhsh.khc.edu.tw) 才能進行申請！' };
    }
    // 安全考量：一律以後端獲取的登入 email 作為寫入值
    formData.email = email;

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

// 格式化日期時間為字串以防 serialization 失敗
function formatDateTime(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm");
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd HH:mm");
    }
  } catch (e) { }
  return String(val);
}

// 供管理者介面讀取所有資料
function getAdminData(sessionId) {
  try {
    var email = getOAuthEmail(sessionId);
    if (!isAdminUser(email)) {
      throw new Error("權限不足：您的帳號無管理員權限！");
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // 只有標頭或空表

    var headers = data[0];
    var rows = data.slice(1);

    return rows.map(function (row, index) {
      return {
        rowNumber: index + 2, // 實際在試算表中的列號（用於更新狀態）
        timestamp: formatDateTime(row[0]),
        chineseName: row[1] || "",
        englishName: row[2] || "",
        quantity: row[3] || 0,
        category: row[4] || "",
        concentration: row[5] || "",
        usageTime: formatDateTime(row[6]),
        subject: row[7] || "",
        email: row[8] || "",
        photoUrl: row[9] || "無照片",
        status: row[10] || "未請購"
      };
    });
  } catch (error) {
    throw new Error(error.message || "載入資料失敗");
  }
}

// 供使用者讀取個人申請紀錄
function getUserData(sessionId) {
  try {
    var email = getOAuthEmail(sessionId);
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return [];
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // 只有標頭或空表

    var headers = data[0];
    var rows = data.slice(1);

    return rows.map(function (row, index) {
      return {
        rowNumber: index + 2,
        timestamp: formatDateTime(row[0]),
        chineseName: row[1] || "",
        englishName: row[2] || "",
        quantity: row[3] || 0,
        category: row[4] || "",
        concentration: row[5] || "",
        usageTime: formatDateTime(row[6]),
        subject: row[7] || "",
        email: row[8] || "",
        photoUrl: row[9] || "無照片",
        status: row[10] || "未請購"
      };
    }).filter(function (item) {
      return item.email.toLowerCase() === email.toLowerCase();
    });
  } catch (error) {
    return [];
  }
}

// 更新特定的請購狀態
function updateProcurementStatus(rowNumber, newStatus, sessionId) {
  try {
    var email = getOAuthEmail(sessionId);
    if (!isAdminUser(email)) {
      return { success: false, message: '操作失敗：您無權執行此操作！' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    // 「是否請購」位於第 11 欄 (K欄)
    sheet.getRange(rowNumber, 11).setValue(newStatus);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

function setAppUrl() {
  PropertiesService.getScriptProperties().setProperty(
    'APP_URL',
    'https://script.google.com/a/macros/fhsh.khc.edu.tw/s/AKfycbw02wBN2z_bXii67odSg_Xoqx11f4RWh9NOVvFBvFutkCT6Q6KtGsbVLtl9c-9KqZVC/exec'
  );
}