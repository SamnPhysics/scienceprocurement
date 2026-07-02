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

function getOAuthService() {
  var props = PropertiesService.getScriptProperties();
  return OAuth2.createService('GoogleAuth')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(props.getProperty('CLIENT_ID') || '')
    .setClientSecret(props.getProperty('CLIENT_SECRET') || '')
    .setCallbackFunction('authCallback')
    // 回歸官方範例：僅使用 PropertiesService 儲存 token，不啟用 CacheService
    .setPropertyStore(PropertiesService.getUserProperties())
    .setLock(LockService.getUserLock())
    .setScope('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile')
    .setParam('access_type', 'offline')
    .setParam('hd', 'fhsh.khc.edu.tw');
}

function authCallback(request) {
  var service = getOAuthService();
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

function getLoginUrl() {
  var service = getOAuthService();
  return service.getAuthorizationUrl();
}

function logoutOAuth() {
  getOAuthService().reset();
  // 使用手動設定的 APP_URL，避免 ScriptApp.getService().getUrl() 返回舊版錯誤格式網址
  return PropertiesService.getScriptProperties().getProperty('APP_URL') || ScriptApp.getService().getUrl();
}

function getOAuthProfile() {
  var service = getOAuthService();
  if (service.hasAccess()) {
    try {
      var url = 'https://www.googleapis.com/oauth2/v2/userinfo';
      var response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + service.getAccessToken()
        }
      });
      var profile = JSON.parse(response.getContentText()) || {};
      return {
        email: profile.email || '',
        displayName: profile.name || ''
      };
    } catch (e) {
      return { email: '', displayName: '' };
    }
  }
  return { email: '', displayName: '' };
}

function getOAuthEmail() {
  return getOAuthProfile().email;
}

// 供前端檢查權限與登入狀態的端點
function getAuthStatus() {
  var profile = getOAuthProfile();
  var email = profile.email;
  var displayName = profile.displayName || (email ? email.split('@')[0] : '');
  if (!email) {
    return { loggedIn: false, email: "", role: "guest", loginUrl: getLoginUrl() };
  }

  if (!email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
    return { loggedIn: true, email: email, displayName: displayName, role: "invalid", message: "非學校網域帳號" };
  }

  var role = isAdminUser(email) ? "admin" : "user";
  return { loggedIn: true, email: email, displayName: displayName, role: role };
}


// 處理表單提交（含圖片解碼與儲存）
function submitApplication(formData) {
  try {
    var profile = getOAuthProfile();
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@fhsh.khc.edu.tw) 才能進行申請！' };
    }
    // 安全考量：一律以後端獲取的登入 email 作為寫入值
    formData.email = email;
    var oauthDisplayName = profile.displayName || '';
    var applicant = (oauthDisplayName || formData.applicant || email.split('@')[0] || '').toString();

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    // 若工作表不存在則建立，並初始化標頭
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '時間戳記', '物品/藥品中文名稱', '藥品英文名稱(含化學式，分子量)或物品名稱',
        '所需數量', '物品分類/化學藥品狀態', '藥品濃度(液態)',
        '課程使用時間', '請勾選所需科別', '申請人','電子郵件地址',
        '物品/藥品照片', '藥品容量(液態)','是否請購'
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
      applicant,
      formData.email,
      photoUrl,
      formData.volume || '無',
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

function mapSheetRow(row, index) {
  // 相容舊版 11 欄、新版 13 欄與過渡期間欄位錯位資料
  var statusSet = { '未請購': true, '已請購': true, '不通過': true };
  var c8 = row[8] || '';
  var c9 = row[9] || '';
  var c10 = row[10] || '';
  var c11 = row[11] || '';
  var c12 = row[12] || '';

  function looksLikeEmail(v) {
    return typeof v === 'string' && v.indexOf('@') !== -1;
  }

  function looksLikeUrl(v) {
    return typeof v === 'string' && /^https?:\/\//i.test(v);
  }

  var email = '';
  if (looksLikeEmail(c9)) {
    email = c9;
  } else if (looksLikeEmail(c8)) {
    email = c8;
  }

  var applicant = '';
  if (c8 && !looksLikeEmail(c8)) {
    applicant = c8;
  } else if (email) {
    applicant = String(email).split('@')[0];
  }

  var photoUrl = '無照片';
  if (looksLikeUrl(c10)) {
    photoUrl = c10;
  } else if (looksLikeUrl(c9)) {
    photoUrl = c9;
  }

  var volume = '';
  if (c11 && !statusSet[c11] && !looksLikeEmail(c11) && !looksLikeUrl(c11)) {
    volume = c11;
  }

  var status = '未請購';
  if (statusSet[c12]) {
    status = c12;
  } else if (statusSet[c11]) {
    status = c11;
  } else if (statusSet[c10]) {
    status = c10;
  }

  return {
    rowNumber: index + 2,
    timestamp: formatDateTime(row[0]),
    chineseName: row[1] || '',
    englishName: row[2] || '',
    quantity: row[3] || 0,
    category: row[4] || '',
    concentration: row[5] || '',
    usageTime: formatDateTime(row[6]),
    subject: row[7] || '',
    applicant: applicant,
    email: email,
    photoUrl: photoUrl,
    volume: volume,
    status: status
  };
}

// 供管理者介面讀取所有資料
function getAdminData() {
  try {
    var email = getOAuthEmail();
    if (!isAdminUser(email)) {
      throw new Error("權限不足：您的帳號無管理員權限！");
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // 只有標頭或空表

    var rows = data.slice(1);

    return rows.map(function (row, index) {
      return mapSheetRow(row, index);
    });
  } catch (error) {
    throw new Error(error.message || "載入資料失敗");
  }
}

// 供使用者讀取個人申請紀錄
function getUserData() {
  try {
    var email = getOAuthEmail();
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return [];
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // 只有標頭或空表

    var rows = data.slice(1);

    var normalizedEmail = email.toLowerCase().trim();

    return rows.map(function (row, index) {
      return mapSheetRow(row, index);
    }).filter(function (item) {
      return String(item.email || '').toLowerCase().trim() === normalizedEmail;
    });
  } catch (error) {
    return [];
  }
}

// 更新特定的請購狀態
function updateProcurementStatus(rowNumber, newStatus) {
  try {
    var email = getOAuthEmail();
    if (!isAdminUser(email)) {
      return { success: false, message: '操作失敗：您無權執行此操作！' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    // 「是否請購」位於第 13 欄 (M欄)
    sheet.getRange(rowNumber, 13).setValue(newStatus);
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