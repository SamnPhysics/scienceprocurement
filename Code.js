
//物品藥品採購表單的填答試算表
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
      '  setTimeout(function() { ' +
      '    try { ' +
      '      document.getElementById("manual-link").click(); ' +
      '    } catch (err) { ' +
      '      window.open("' + appUrl + '", "_top"); ' +
      '    } ' +
      '  }, 1000);' +
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
  if (!service.hasAccess()) {
    return { email: '', displayName: '' };
  }

  var token = service.getAccessToken();
  var cache = CacheService.getUserCache();
  // 使用 token 後綴當作快取 key，避免超過 Cache Key 長度限制 (250 chars)
  var cacheKey = 'oauth_profile_' + token.substring(token.length - 20);

  var cachedProfile = cache.get(cacheKey);
  if (cachedProfile) {
    try {
      return JSON.parse(cachedProfile);
    } catch (e) { }
  }

  try {
    var url = 'https://www.googleapis.com/oauth2/v2/userinfo';
    var response = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });
    var profile = JSON.parse(response.getContentText()) || {};
    var result = {
      email: profile.email || '',
      displayName: profile.name || ''
    };

    // 快取 1 小時 (3600 秒)
    cache.put(cacheKey, JSON.stringify(result), 3600);
    return result;
  } catch (e) {
    return { email: '', displayName: '' };
  }
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
        '課程使用時間', '請勾選所需科別', '申請人', '電子郵件地址',
        '物品/藥品照片', '藥品容量(液態)', '是否請購', '備註', '採購總價'
      ]);
    }

    var photoUrl = '無照片';

    // 處理圖片上傳
    if (formData.photoBase64 && formData.photoName) {
      var splitData = formData.photoBase64.split(',');
      var contentType = splitData[0].split(':')[1].split(';')[0];
      var base64Data = splitData[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, formData.photoName);

      // 建立檔案於指定的雲端硬碟資料夾
      var folderId = '0B4BxlK1u01jlfnZoU0xObGNVMkYwbWZDalNTd05CMTBhYUZxY0k4RjFKTlJ3VmNLMFVTRmM';
      var folder = DriveApp.getFolderById(folderId);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = file.getUrl();
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: '提交失敗：系統目前忙碌中，請稍後再試。' };
    }

    try {
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
        '未請購', // 預設初始狀態
        formData.remark || '',
        '' // 初始採購總價為空
      ]);

      // 資料更新後，清除快取
      CacheService.getScriptCache().remove('sheet_data_cache');
    } finally {
      lock.releaseLock();
    }

    // 發送通知信件給管理者
    try {
      var emailTo = "5501@fhsh.khc.edu.tw,5502@fhsh.khc.edu.tw";
      var subject = "【自然學科請購系統】有新的請購申請 - " + applicant;
      var body = "管理員您好，\n\n" +
                 "系統剛收到一筆新的請購申請：\n\n" +
                 "- 申請人：" + applicant + "\n" +
                 "- 科別：" + formData.subject + "\n" +
                 "- 物品名稱：" + formData.chineseName + "\n" +
                 "- 數量：" + formData.quantity + "\n" +
                 "- 備註：" + (formData.remark || '無') + "\n\n" +
                 "請登入系統管理員後台查看詳細內容並進行處理。\n";
                 
      GmailApp.sendEmail(emailTo, subject, body);
    } catch (emailError) {
      // 忽略信件發送失敗，不影響表單儲存
      console.error("發送信件失敗: " + emailError.toString());
    }

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

// 格式化日期僅包含年月日 (yyyy-MM-dd)
function formatDateOnly(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd");
    }
  } catch (e) { }
  var str = String(val).trim();
  if (str.indexOf(' ') !== -1) {
    str = str.split(' ')[0];
  }
  if (str.indexOf('T') !== -1) {
    str = str.split('T')[0];
  }
  return str;
}

function mapSheetRow(row, index, colMap) {
  colMap = colMap || {};
  function getVal(colName, defaultIdx) {
    var idx = colMap.hasOwnProperty(colName) ? colMap[colName] : defaultIdx;
    return row[idx] !== undefined ? row[idx] : '';
  }

  var timestamp = getVal('時間戳記', 0);
  var chineseName = getVal('物品/藥品中文名稱', 1);
  var englishName = getVal('藥品英文名稱(含化學式，分子量)或物品名稱', 2);
  var quantity = getVal('所需數量', 3);
  var category = getVal('物品分類/化學藥品狀態', 4);
  var concentration = getVal('藥品濃度(液態)', 5);
  var usageTime = formatDateTime(getVal('課程使用時間', 6));
  var subject = getVal('請勾選所需科別', 7);
  var applicant = getVal('申請人', 8);
  var email = getVal('電子郵件地址', 9);
  var photoUrl = getVal('物品/藥品照片', 10);
  var volume = getVal('藥品容量(液態)', 11);
  var status = getVal('是否請購', 12) || '未請購';
  var remark = getVal('備註', 13);
  var totalPrice = getVal('採購總價', 14);

  // === 保留相容舊版錯位資料的安全機制 ===
  var statusSet = { '未請購': true, '已請購': true, '不通過': true };
  function looksLikeEmail(v) { return typeof v === 'string' && v.indexOf('@') !== -1; }
  function looksLikeUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }

  if (!looksLikeEmail(email)) {
    if (looksLikeEmail(applicant)) { email = applicant; }
    else if (looksLikeEmail(photoUrl)) { email = photoUrl; }
    else if (looksLikeEmail(row[8])) { email = row[8]; }
  }

  if (photoUrl !== '無照片' && !looksLikeUrl(photoUrl)) {
    if (looksLikeUrl(email)) { photoUrl = email; }
    else if (looksLikeUrl(row[9])) { photoUrl = row[9]; }
    else if (looksLikeUrl(row[10])) { photoUrl = row[10]; }
    else { photoUrl = '無照片'; }
  }
  if (!photoUrl) photoUrl = '無照片';

  if (!statusSet[status]) {
    if (statusSet[row[12]]) status = row[12];
    else if (statusSet[row[11]]) status = row[11];
    else if (statusSet[row[10]]) status = row[10];
    else status = '未請購';
  }

  if (applicant === email || looksLikeEmail(applicant)) {
    applicant = String(email).split('@')[0];
  }

  return {
    rowNumber: index + 2,
    timestamp: formatDateOnly(timestamp),
    chineseName: chineseName,
    englishName: englishName,
    quantity: quantity,
    category: category,
    concentration: concentration,
    usageTime: usageTime,
    subject: subject,
    applicant: applicant,
    email: email,
    photoUrl: photoUrl,
    volume: volume,
    status: status,
    remark: remark,
    totalPrice: totalPrice
  };
}

function getSheetData() {
  var cache = CacheService.getScriptCache();
  var cachedData = cache.get('sheet_data_cache');
  if (cachedData) {
    try {
      return JSON.parse(cachedData);
    } catch (e) { }
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // 只有標頭或空表

  var headers = data[0];
  var colMap = {};
  for (var i = 0; i < headers.length; i++) {
    colMap[headers[i]] = i;
  }

  var rows = data.slice(1);

  var mappedData = rows.map(function (row, index) {
    return mapSheetRow(row, index, colMap);
  });

  // 依照時間倒數列出
  var reversedData = mappedData.reverse();

  try {
    // 寫入快取 1 小時，最大限制約 100KB。若資料過大會引發例外，則忽略快取。
    cache.put('sheet_data_cache', JSON.stringify(reversedData), 3600);
  } catch (e) { }

  return reversedData;
}

// 供管理者介面讀取所有資料
function getAdminData() {
  try {
    var email = getOAuthEmail();
    if (!isAdminUser(email)) {
      throw new Error("權限不足：您的帳號無管理員權限！");
    }

    return getSheetData();
  } catch (error) {
    throw new Error(error.message || "載入資料失敗");
  }
}

function getUserData() {
  try {
    var email = getOAuthEmail();
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return [];
    }
    var normalizedEmail = email.toLowerCase().trim();
    return getSheetData().filter(function (item) {
      return String(item.email || '').toLowerCase().trim() === normalizedEmail;
    });
  } catch (error) {
    return [];
  }
}

// 更新特定的請購狀態與總價
function updateProcurementStatus(rowNumber, newStatus, totalPrice) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '操作失敗：系統目前忙碌中，請稍後再試。' };
  }

  try {
    var email = getOAuthEmail();
    if (!isAdminUser(email)) {
      return { success: false, message: '操作失敗：您無權執行此操作！' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    // 動態找欄位索引
    var headers = sheet.getRange(1, 1, 1, Math.max(15, sheet.getLastColumn())).getValues()[0];
    var statusColIdx = headers.indexOf('是否請購') + 1;
    var priceColIdx = headers.indexOf('採購總價') + 1;

    // 萬一找不到表頭則使用預設值
    if (statusColIdx === 0) statusColIdx = 13;
    if (priceColIdx === 0) priceColIdx = 15;

    sheet.getRange(rowNumber, statusColIdx).setValue(newStatus);
    sheet.getRange(rowNumber, priceColIdx).setValue(totalPrice);

    // 清除快取
    CacheService.getScriptCache().remove('sheet_data_cache');
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// 供一般使用者刪除（取消）屬於自己的請購紀錄
function deleteUserRequests(rowNumbers) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '系統目前忙碌中，請稍後再試。' };
  }

  try {
    var email = getOAuthEmail();
    if (!email || !email.toLowerCase().endsWith('@fhsh.khc.edu.tw')) {
      return { success: false, message: '操作失敗：驗證身分失敗。' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    // 先讀取所有資料到記憶體以進行批量驗證，減少對 sheet.getRange 迴圈的依賴
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, message: '找不到資料表內容。' };

    var headers = data[0];
    var emailColIdx = headers.indexOf('電子郵件地址');
    if (emailColIdx === -1) emailColIdx = 9; // Fallback to 0-indexed 9

    // 由大到小排序，避免刪除列後導致後續列號錯位
    rowNumbers.sort(function (a, b) { return b - a; });

    for (var i = 0; i < rowNumbers.length; i++) {
      var rowNum = rowNumbers[i];
      if (rowNum < 2 || rowNum > data.length) {
        throw new Error('無效的列號：' + rowNum);
      }

      // data 是 0-indexed，rowNum 是 1-indexed
      var rowEmail = data[rowNum - 1][emailColIdx];

      if (String(rowEmail).toLowerCase().trim() === email.toLowerCase().trim()) {
        sheet.deleteRow(rowNum);
      } else {
        throw new Error('安全性錯誤：您無權刪除其他人的請購項目！');
      }
    }

    // 清除快取
    CacheService.getScriptCache().remove('sheet_data_cache');
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

function setAppUrl() {
  PropertiesService.getScriptProperties().setProperty(
    'APP_URL',
    'https://script.google.com/a/macros/fhsh.khc.edu.tw/s/AKfycbw02wBN2z_bXii67odSg_Xoqx11f4RWh9NOVvFBvFutkCT6Q6KtGsbVLtl9c-9KqZVC/exec'
  );
}