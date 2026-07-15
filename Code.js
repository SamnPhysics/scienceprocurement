// ====== 全域變數定義 ======
// 從屬性服務讀取環境參數
const props = PropertiesService.getScriptProperties();
const CLIENT_ID = props.getProperty('CLIENT_ID');
const CLIENT_SECRET = props.getProperty('CLIENT_SECRET');


const SPREADSHEET_ID = props.getProperty('SPREADSHEET_ID');
const UPLOAD_FOLDER_ID = props.getProperty('FOLDER_ID');
const WEB_APP_URL = props.getProperty('WEB_APP_URL');
const ADMIN_BACKEND_URL = props.getProperty('ADMIN_BACKEND_URL');
const ALLOWED_DOMAIN = props.getProperty('ALLOWED_DOMAIN');

const SHEET_NAME = '表單回應 1';

// 取得管理員 Email 列表 (以逗號分隔)，並轉為陣列
const ADMIN_EMAILS_STR = props.getProperty('ADMIN_EMAILS');
const ADMIN_EMAILS = ADMIN_EMAILS_STR.split(',').map(function (e) { return e.trim(); });

// 阻擋名單規則 (可以是正規表達式 RegExp，或是特定的 Email 字串)
const BLOCKED_ACCOUNT_RULES = [
  /^\d{6}@/i,  // 阻擋學生帳號 (判斷邏輯：信箱開頭為 's' 加上數字，或純數字)
  // 'example@' + ALLOWED_DOMAIN // 未來若要阻擋特定帳號，可直接加在這裡
];

function isAdminUser(email) {
  if (!email) return false;
  return ADMIN_EMAILS.indexOf(email.toLowerCase()) !== -1;
}

// 判斷是否為被阻擋的帳號
function isBlockedUser(email) {
  if (!email) return false;
  for (var i = 0; i < BLOCKED_ACCOUNT_RULES.length; i++) {
    var rule = BLOCKED_ACCOUNT_RULES[i];
    if (rule instanceof RegExp) {
      if (rule.test(email)) return true;
    } else if (typeof rule === 'string') {
      if (email.toLowerCase() === rule.toLowerCase()) return true;
    }
  }
  return false;
}

// 供開發者在編輯器內手動執行，以觸發 Email 授權視窗
function testEmail() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), "測試授權", "如果您收到這封信，代表發信授權成功！");
}

// 動態取得 Web App URL
function getAppUrl() {
  return WEB_APP_URL;
}

// 供前端取得 Client ID
function getClientId() {
  return CLIENT_ID;
}

// 供前端取得登入網址
function getLoginUrl() {
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(getAppUrl()) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile') +
    '&access_type=offline' +
    '&hd=' + encodeURIComponent(ALLOWED_DOMAIN);
  return authUrl;
}

// ====== 路由判斷 ======

function doGet(e) {
  // 如果帶有 code 參數，表示是 Google 授權後跳轉回來
  if (e.parameter.code) {
    return processOAuthCallback(e.parameter.code);
  } else {
    // 渲染首頁，如果有 session_token 參數，就傳給前端樣板
    var template = HtmlService.createTemplateFromFile('Index');
    template.sessionToken = e.parameter.session_token || '';
    template.appUrl = getAppUrl();

    // 取得前端動態渲染參數
    var p = PropertiesService.getScriptProperties();
    template.schoolName = p.getProperty('SCHOOL_NAME');
    template.schoolAddress = p.getProperty('SCHOOL_ADDRESS');
    template.schoolPhone = p.getProperty('SCHOOL_PHONE');
    template.systemTitle = p.getProperty('SYSTEM_TITLE');
    template.systemDesc = p.getProperty('SYSTEM_DESC');
    template.allowedDomain = p.getProperty('ALLOWED_DOMAIN');
    template.logoId = p.getProperty('LOGO_ID');

    return template.evaluate()
      .setTitle(template.systemTitle)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}

// ====== 後端處理 OAuth Callback 與發放 Token ======

function processOAuthCallback(code) {
  try {
    // 1. 交換 Token
    const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: getAppUrl(),
        grant_type: 'authorization_code'
      },
      muteHttpExceptions: true
    });

    const tokenData = JSON.parse(tokenResponse.getContentText());
    if (tokenData.error) {
      throw new Error('Token 交換失敗: ' + tokenData.error_description);
    }

    const accessToken = tokenData.access_token;

    // 2. 取得 UserInfo
    const userResponse = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });

    const userData = JSON.parse(userResponse.getContentText());
    if (userData.error) {
      throw new Error('無法獲取使用者資訊');
    }

    const profile = {
      email: userData.email || '',
      name: userData.name || '',
      picture: userData.picture || ''
    };

    // 3. 產生專屬 Session Token 並寫入 Cache (保存 6 小時 = 21600 秒)
    const sessionToken = Utilities.getUuid();
    CacheService.getScriptCache().put('session_' + sessionToken, JSON.stringify(profile), 21600);

    // 4. 回傳一段腳本，讓整個畫面導向帶有 Token 的網址
    var appUrl = getAppUrl();
    var redirectUrl = appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + 'session_token=' + encodeURIComponent(sessionToken);

    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
          // 嘗試自動跳轉
          setTimeout(function() {
            try {
              window.top.location.href = "${redirectUrl}";
            } catch(e) {
              console.log("自動跳轉被阻擋", e);
            }
          }, 500);
        </script>
      </head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen">
        <div class="bg-white p-8 rounded-xl shadow-lg text-center max-w-sm w-full mx-4">
          <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h2 class="text-2xl font-bold text-slate-800 mb-2">登入成功！</h2>
          <p class="text-slate-500 mb-6">如果畫面沒有自動跳轉，請點擊下方按鈕返回系統。</p>
          <a href="${redirectUrl}" target="_top" class="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-200">
            回到系統主頁
          </a>
        </div>
      </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(html);
  } catch (error) {
    return HtmlService.createHtmlOutput('授權失敗: ' + error.message);
  }
}

// 驗證前端傳來的 Session Token
function verifySessionToken(token) {
  if (!token) throw new Error('未提供登入憑證 (Token)，請重新登入。');

  var cachedData = CacheService.getScriptCache().get('session_' + token);
  if (!cachedData) {
    throw new Error('登入已逾期或無效，請重新登入。');
  }

  try {
    return JSON.parse(cachedData);
  } catch (e) {
    throw new Error('身分資料解析失敗，請重新登入。');
  }
}

// 供前端檢查權限與登入狀態的端點
function getAuthStatus(token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    var displayName = profile.name || email.split('@')[0];

    if (!email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { loggedIn: true, email: email, displayName: displayName, role: "invalid", message: "非學校網域帳號" };
    }

    // 檢查是否在阻擋名單內
    if (isBlockedUser(email)) {
      return { loggedIn: true, email: email, displayName: displayName, role: "invalid", message: "您的帳號禁止使用本系統" };
    }

    var role = isAdminUser(email) ? "admin" : "user";
    return { loggedIn: true, email: email, displayName: displayName, role: role, picture: profile.picture };
  } catch (e) {
    return { loggedIn: false, email: "", role: "guest", loginUrl: getLoginUrl() };
  }
}

// ====== 原有業務邏輯 (每個 API 皆加入 sessionToken 參數) ======

// 處理表單提交（含圖片解碼與儲存）
function submitApplication(formData, token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    // 阻擋帳號防護 (後端二次檢查)
    if (isBlockedUser(email)) {
      return { success: false, message: '提交失敗：您的帳號禁止使用此系統！' };
    }

    // 安全考量：一律以後端獲取的登入 email 作為寫入值
    formData.email = email;
    var applicant = (profile.name || formData.applicant || email.split('@')[0] || '').toString();

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
      var folderId = UPLOAD_FOLDER_ID;
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

      CacheService.getScriptCache().remove('sheet_data_cache');
    } finally {
      lock.releaseLock();
    }

    // 發送 Email 通知給管理者
    try {
      var subjectStr = "【新採購申請通知】" + formData.chineseName;

      var bodyStr = "系統收到一筆新的藥品/物品採購申請：\n\n" +
        "申請人：" + applicant + "\n" +
        "科別：" + formData.subject + "\n" +
        "中文名稱：" + formData.chineseName + "\n" +
        "英文名稱：" + formData.englishName + "\n" +
        "數量：" + formData.quantity + "\n" +
        "使用時間：" + formData.usageTime + "\n" +
        "備註：" + (formData.remark || '無') + "\n\n" +
        "請登入系統管理者後台查看詳細內容並進行審核： " + ADMIN_BACKEND_URL;

      var htmlBodyStr = "系統收到一筆新的藥品/物品採購申請：<br><br>" +
        "<b>申請人：</b>" + applicant + "<br>" +
        "<b>科別：</b>" + formData.subject + "<br>" +
        "<b>中文名稱：</b>" + formData.chineseName + "<br>" +
        "<b>英文名稱：</b>" + formData.englishName + "<br>" +
        "<b>數量：</b>" + formData.quantity + "<br>" +
        "<b>使用時間：</b>" + formData.usageTime + "<br>" +
        "<b>備註：</b>" + (formData.remark || '無') + "<br><br>" +
        "請 <a href='" + ADMIN_BACKEND_URL + "'>登入系統管理者後台</a> 查看詳細內容並進行審核。";

      MailApp.sendEmail(ADMIN_EMAILS.join(","), subjectStr, bodyStr, {
        htmlBody: htmlBodyStr,
        name: "自然科採購系統"
      });
    } catch (e) {
      console.log("Email發送失敗: " + e.toString());
      return { success: true, message: '資料與照片提交成功！(但Email通知發送失敗：' + e.toString() + ')' };
    }

    return { success: true, message: '資料與照片提交成功！' };
  } catch (error) {
    return { success: false, message: '後端錯誤: ' + error.toString() };
  }
}

// 處理整批表單提交 (由 Excel 匯入)
function submitBatchApplication(batchData, token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    if (isBlockedUser(email)) {
      return { success: false, message: '提交失敗：您的帳號禁止使用此系統！' };
    }

    if (!batchData || batchData.length === 0) {
      return { success: false, message: '提交失敗：匯入的資料為空。' };
    }

    var applicant = (profile.name || email.split('@')[0] || '').toString();
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '時間戳記', '物品/藥品中文名稱', '藥品英文名稱(含化學式，分子量)或物品名稱',
        '所需數量', '物品分類/化學藥品狀態', '藥品濃度(液態)',
        '課程使用時間', '請勾選所需科別', '申請人', '電子郵件地址',
        '物品/藥品照片', '藥品容量(液態)', '是否請購', '備註', '採購總價'
      ]);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { // 批次寫入允許較長的 lock
      return { success: false, message: '提交失敗：系統目前忙碌中，請稍後再試。' };
    }

    try {
      var rowsToInsert = [];
      var timestamp = new Date();

      for (var i = 0; i < batchData.length; i++) {
        var item = batchData[i];
        rowsToInsert.push([
          timestamp,
          item.chineseName || '',
          item.englishName || '',
          item.quantity || '',
          item.category || '',
          item.concentration || '無',
          item.usageTime || '',
          item.subject || '',
          applicant,
          email,
          '無照片', // 批次匯入目前不支援照片
          item.volume || '無',
          '未請購',
          item.remark || '',
          ''
        ]);
      }

      // 批次寫入
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);

      CacheService.getScriptCache().remove('sheet_data_cache');
    } finally {
      lock.releaseLock();
    }

    // 發送 Email 通知給管理者
    try {
      var subjectStr = "【新採購申請通知】" + applicant + " 提交了 " + batchData.length + " 筆批次申請";
      
      // 整理批次匯入的項目清單 (最多顯示 20 筆，避免信件過長)
      var itemSummary = "";
      var htmlItemSummary = "<ul>";
      var displayLimit = Math.min(batchData.length, 20);
      
      for (var j = 0; j < displayLimit; j++) {
        var itm = batchData[j];
        itemSummary += "- " + itm.chineseName + " (" + itm.quantity + ")\n";
        htmlItemSummary += "<li>" + itm.chineseName + " (" + itm.quantity + ")</li>";
      }
      
      if (batchData.length > 20) {
        itemSummary += "...以及其他 " + (batchData.length - 20) + " 項物品\n";
        htmlItemSummary += "<li>...以及其他 " + (batchData.length - 20) + " 項物品</li>";
      }
      htmlItemSummary += "</ul>";

      var bodyStr = "系統收到一批新的藥品/物品採購申請：\n\n" +
        "申請人：" + applicant + "\n" +
        "申請筆數：" + batchData.length + " 筆\n" +
        "申請項目：\n" + itemSummary + "\n" +
        "請登入系統管理者後台查看詳細內容並進行審核： " + ADMIN_BACKEND_URL;

      var htmlBodyStr = "系統收到一批新的藥品/物品採購申請：<br><br>" +
        "<b>申請人：</b>" + applicant + "<br>" +
        "<b>申請筆數：</b>" + batchData.length + " 筆<br>" +
        "<b>申請項目：</b>" + htmlItemSummary + "<br>" +
        "請 <a href='" + ADMIN_BACKEND_URL + "'>登入系統管理者後台</a> 查看詳細內容並進行審核。";

      MailApp.sendEmail(ADMIN_EMAILS.join(","), subjectStr, bodyStr, {
        htmlBody: htmlBodyStr,
        name: "自然科採購系統"
      });
    } catch (e) {
      console.log("Email發送失敗: " + e.toString());
      return { success: true, message: '批次資料提交成功！(但Email通知發送失敗：' + e.toString() + ')' };
    }

    return { success: true, message: '成功匯入 ' + batchData.length + ' 筆資料！' };
  } catch (error) {
    return { success: false, message: '後端錯誤: ' + error.toString() };
  }
}

// 供管理者介面讀取所有資料
function getAdminData(token) {
  try {
    var profile = verifySessionToken(token);
    if (!isAdminUser(profile.email)) {
      throw new Error("權限不足：您的帳號無管理員權限！");
    }

    return getSheetData();
  } catch (error) {
    throw new Error(error.message || "載入資料失敗");
  }
}

// 供一般使用者讀取自己的資料
function getUserData(token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
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

// 更新特定的請購狀態與總價 (限管理員)
function updateProcurementStatus(rowNumber, newStatus, totalPrice, token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '操作失敗：系統目前忙碌中，請稍後再試。' };
  }

  try {
    var profile = verifySessionToken(token);
    if (!isAdminUser(profile.email)) {
      return { success: false, message: '操作失敗：您無權執行此操作！' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    var headers = sheet.getRange(1, 1, 1, Math.max(15, sheet.getLastColumn())).getValues()[0];
    var statusColIdx = headers.indexOf('是否請購') + 1 || 13;
    var priceColIdx = headers.indexOf('採購總價') + 1 || 15;

    sheet.getRange(rowNumber, statusColIdx).setValue(newStatus);
    sheet.getRange(rowNumber, priceColIdx).setValue(totalPrice);

    CacheService.getScriptCache().remove('sheet_data_cache');
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// 供一般使用者刪除（取消）屬於自己的請購紀錄
function deleteUserRequests(rowNumbers, token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '系統目前忙碌中，請稍後再試。' };
  }

  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '操作失敗：驗證身分失敗。' };
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, message: '找不到資料表內容。' };

    var headers = data[0];
    var emailColIdx = headers.indexOf('電子郵件地址');
    if (emailColIdx === -1) emailColIdx = 9;

    rowNumbers.sort(function (a, b) { return b - a; });

    for (var i = 0; i < rowNumbers.length; i++) {
      var rowNum = rowNumbers[i];
      if (rowNum < 2 || rowNum > data.length) {
        throw new Error('無效的列號：' + rowNum);
      }

      var rowEmail = data[rowNum - 1][emailColIdx];
      if (String(rowEmail).toLowerCase().trim() === email.toLowerCase().trim()) {
        sheet.deleteRow(rowNum);
      } else {
        throw new Error('安全性錯誤：您無權刪除其他人的請購項目！');
      }
    }

    CacheService.getScriptCache().remove('sheet_data_cache');
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// 登出：清除後端快取
function logoutOAuth(token) {
  if (token) {
    CacheService.getScriptCache().remove('session_' + token);
  }
  return { success: true };
}

// ====== 輔助函式 ======

function formatDateTime(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd HH:mm");
  }
  return String(val);
}

function formatDateOnly(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
  }
  var str = String(val).trim();
  return str.split(' ')[0].split('T')[0];
}

function mapSheetRow(row, index, colMap) {
  var getVal = function (colName, defaultIdx) {
    var idx = colMap.hasOwnProperty(colName) ? colMap[colName] : defaultIdx;
    return row[idx] !== undefined ? row[idx] : '';
  };
  return {
    rowNumber: index + 2,
    timestamp: formatDateOnly(getVal('時間戳記', 0)),
    chineseName: getVal('物品/藥品中文名稱', 1),
    englishName: getVal('藥品英文名稱(含化學式，分子量)或物品名稱', 2),
    quantity: getVal('所需數量', 3),
    category: getVal('物品分類/化學藥品狀態', 4),
    concentration: getVal('藥品濃度(液態)', 5),
    usageTime: formatDateTime(getVal('課程使用時間', 6)),
    subject: getVal('請勾選所需科別', 7),
    applicant: getVal('申請人', 8),
    email: getVal('電子郵件地址', 9),
    photoUrl: getVal('物品/藥品照片', 10) || '無照片',
    volume: getVal('藥品容量(液態)', 11),
    status: getVal('是否請購', 12) || '未請購',
    remark: getVal('備註', 13),
    totalPrice: getVal('採購總價', 14)
  };
}

function getSheetData() {
  var cache = CacheService.getScriptCache();
  var cachedData = cache.get('sheet_data_cache');
  if (cachedData) {
    try { return JSON.parse(cachedData); } catch (e) { }
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var colMap = {};
  for (var i = 0; i < headers.length; i++) {
    colMap[headers[i]] = i;
  }

  var rows = data.slice(1);
  var mappedData = rows.map(function (row, index) {
    return mapSheetRow(row, index, colMap);
  });

  var reversedData = mappedData.reverse();
  try {
    cache.put('sheet_data_cache', JSON.stringify(reversedData), 3600);
  } catch (e) { }

  return reversedData;
}

// ====== 開發者輔助設定區 ======
/**
 * 首次建置環境或轉移環境時，可於編輯器內執行此函式
 * 以便將環境變數寫入 PropertiesService 中
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    // 【必填】存放申請表單資料的 Google 試算表 ID (從網址中擷取)
    'SPREADSHEET_ID': '請設定 SPREADSHEET_ID',

    // 【必填】存放使用者上傳圖片的 Google Drive 資料夾 ID (必須設定為知道連結者可檢視)
    'FOLDER_ID': '請設定 FOLDER_ID',

    // 【必填】部署為網頁應用程式後的 URL (用於 OAuth 授權的 Redirect URI)
    'WEB_APP_URL': '請設定 WEB_APP_URL',

    // 【選填】發送給管理員信件中附帶的後台短網址 (或與 WEB_APP_URL 相同亦可)
    'ADMIN_BACKEND_URL': '請設定 ADMIN_BACKEND_URL',

    // 【必填】系統管理員的信箱列表，以逗號分隔 (擁有後台審核權限及收信權限)
    'ADMIN_EMAILS': '請設定 ADMIN_EMAILS',

    // 【必填】允許登入的組織網域，例如 fhsh.khc.edu.tw (未設定則無法進行網域限制)
    'ALLOWED_DOMAIN': '請設定 ALLOWED_DOMAIN',

    // 【選填】前端介面顯示的學校名稱
    'SCHOOL_NAME': '請設定 SCHOOL_NAME',

    // 【選填】前端介面 Footer 顯示的學校地址
    'SCHOOL_ADDRESS': '請設定 SCHOOL_ADDRESS',

    // 【選填】前端介面 Footer 顯示的學校聯絡電話
    'SCHOOL_PHONE': '請設定 SCHOOL_PHONE',

    // 【選填】系統的標題名稱 (顯示於網頁標題與上方導覽列)，可自行更換
    'SYSTEM_TITLE': '請設定 SYSTEM_TITLE',

    // 【選填】表單上方的系統詳細說明文字
    'SYSTEM_DESC': '請設定 SYSTEM_DESC',

    // 【選填】前端介面左上角的 Logo 圖片 (Google Drive 檔案 ID)
    'LOGO_ID': '請設定 LOGO_ID',

    // 注意：CLIENT_ID 與 CLIENT_SECRET 用來連接GCP相關資料
    'CLIENT_ID': '',
    'CLIENT_SECRET': ''
  });
  Logger.log('環境變數設定完成！');
}