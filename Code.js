// =====================================================================
// 【ZONE 1】全域系統配置與參數中心 (Global Configuration Core)
// =====================================================================
// 效能優化：一次性讀取所有屬性，避免重複呼叫 PropertiesService (RPC 效能瓶頸)
const ENV_PROPS = PropertiesService.getScriptProperties().getProperties();
const CLIENT_ID = ENV_PROPS['CLIENT_ID'] || '';
const CLIENT_SECRET = ENV_PROPS['CLIENT_SECRET'] || '';

// --- 系統庫與試算表索引 ID ---
const SPREADSHEET_ID = ENV_PROPS['SPREADSHEET_ID'] || '';  // 藥品/物品請購 試算表ID
const EQUIP_SHEET_ID = ENV_PROPS['EQUIP_SHEET_ID'] || '';  // 設備申請 試算表ID
const EQUIP_BORROW_SHEET_ID = ENV_PROPS['EQUIP_BORROW_SHEET_ID'] || '';  // 設備借用 試算表ID
const LAB_SPREADSHEET_ID = ENV_PROPS['LAB_SPREADSHEET_ID'] || '';      // 實驗室預約 試算表ID
const UPLOAD_FOLDER_ID = ENV_PROPS['FOLDER_ID'] || '';                        // 表單檔案雲端硬碟資料夾ID

// --- 系統對外網址與網域設定 ---
const WEB_APP_URL = ENV_PROPS['WEB_APP_URL'] || '';                           // 前端網址 (GCP, OAuth2使用)
const ADMIN_BACKEND_URL = ENV_PROPS['ADMIN_BACKEND_URL'] || '';               // 後端網址
const ALLOWED_DOMAIN = ENV_PROPS['ALLOWED_DOMAIN'] || '';                     // 允許登入之校內信箱網域

// --- 工表標籤名稱字典 (Sheet Names) ---
const SHEET_NAME = '表單回應 1';                                               // 藥品請購、設備申請/借用、實驗室預約之主工表名稱
const SHEET_NAME_LAB_ROOMS = '可預約教室列表';                                 // 實驗室與空間選單設定
const SHEET_NAME_LAB_PERIODS = '時間節數對應表';                               // 課堂與開放時段設定

// --- 系統 UI 與品牌設定資訊 (避免各函數重複抓取 ENV_PROPS) ---
const UI_CONFIG = {
  schoolName: ENV_PROPS['SCHOOL_NAME'] || '',
  schoolAddress: ENV_PROPS['SCHOOL_ADDRESS'] || '',
  schoolPhone: ENV_PROPS['SCHOOL_PHONE'] || '',
  systemTitle: ENV_PROPS['SYSTEM_TITLE'] || '',
  systemDesc: ENV_PROPS['SYSTEM_DESC'] || '',
  logoId: ENV_PROPS['LOGO_ID'] || ''
};

// =====================================================================
// 【ZONE 2】權限判定與 OAuth2 身分驗證安全模組 (Auth & Security)
// =====================================================================

// --- 管理員信箱名單與特例白名單 ---
const ADMIN_EMAILS_STR = ENV_PROPS['ADMIN_EMAILS'] || '';
const ADMIN_EMAILS = ADMIN_EMAILS_STR.split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(function (e) { return e !== ''; });


function isAdminUser(email) {
  if (!email) return false;
  var norm = email.toLowerCase().trim();
  return ADMIN_EMAILS.indexOf(norm) !== -1;
}

// 判斷是否為學生帳號 (學生帳號規則：6位數字開頭)
function isStudentAccount(email) {
  if (!email) return false;
  // 特例保護：如果是管理員帳號，絕對不可以被判斷為學生
  if (isAdminUser(email)) return false;

  const studentRegex = /^\d{6}@/i;
  return studentRegex.test(String(email).trim());
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

// =====================================================================
// 【ZONE 2.5】XSS 防護與輸入驗證模組 (Sanitization & Validation)
// =====================================================================

// --- 輸入驗證 Helpers ---
function validateRequired(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error('「' + fieldName + '」為必填欄位，請勿留空。');
  }
}

function validateNumber(value, min, fieldName) {
  var num = Number(value);
  if (isNaN(num)) {
    throw new Error('「' + fieldName + '」必須為數字。');
  }
  if (num < min) {
    throw new Error('「' + fieldName + '」不可小於 ' + min + '。');
  }
}

function validateLength(value, max, fieldName) {
  if (value && String(value).length > max) {
    throw new Error('「' + fieldName + '」長度不可超過 ' + max + ' 字元。');
  }
}

// --- XSS 防護 Helpers ---
function sanitizeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
}

function sanitizeFormData(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(function(item) { return sanitizeFormData(item); });
  }

  var sanitizedObj = {};
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'string') {
        // 排除 base64 圖片資料，避免破壞圖檔編碼
        if (key === 'photoBase64') {
          sanitizedObj[key] = obj[key];
        } else {
          sanitizedObj[key] = sanitizeHtml(obj[key]);
        }
      } else if (typeof obj[key] === 'object') {
        sanitizedObj[key] = sanitizeFormData(obj[key]);
      } else {
        sanitizedObj[key] = obj[key];
      }
    }
  }
  return sanitizedObj;
}

// --- 具體表單驗證 Helpers ---
function validateChemFormData(fd) {
  validateRequired(fd.chineseName, '物品/藥品中文名稱');
  validateLength(fd.chineseName, 100, '物品/藥品中文名稱');
  validateRequired(fd.subject, '請勾選所需科別');
  validateLength(fd.subject, 50, '所需科別');
  validateRequired(fd.category, '物品分類/化學藥品狀態');
  validateNumber(fd.quantity, 1, '所需數量');
  validateLength(fd.englishName, 100, '藥品英文名稱');
  validateLength(fd.remark, 1000, '備註');
}

function validateEquipBorrowFormData(fd) {
  validateRequired(fd.item, '借用物品');
  validateLength(fd.item, 100, '借用物品');
  validateRequired(fd.department, '科室');
  validateRequired(fd.purpose, '借用說明');
  validateLength(fd.purpose, 500, '借用說明');
  validateNumber(fd.quantity, 1, '數量');
  validateLength(fd.remark, 1000, '備註');
}

function validateEquipFormData(fd) {
  validateRequired(fd.equipName, '設備名稱/軟體名稱');
  validateLength(fd.equipName, 100, '設備名稱/軟體名稱');
  validateRequired(fd.applySubject, '申請科別');
  validateRequired(fd.purpose, '需求及用途說明');
  validateLength(fd.purpose, 1000, '需求及用途說明');
  validateNumber(fd.quantity, 1, '數量');
  validateNumber(fd.price, 0, '自估單價');
  validateLength(fd.remark, 1000, '備註');
}

function validateLabBookingData(fd) {
  validateRequired(fd.date, '預約日期');
  validateRequired(fd.room, '預約場地');
  validateRequired(fd.start, '開始時間');
  validateRequired(fd.end, '結束時間');
  validateRequired(fd.title, '課程/活動名稱');
  validateLength(fd.title, 100, '課程/活動名稱');
  validateLength(fd.remark, 1000, '備註');
}

// =====================================================================
// 【ZONE 3】Web 伺服器路由與 HTML 渲染導覽 (Server Routing & Templating)
// =====================================================================

function doGet(e) {
  // 如果帶有 code 參數，表示是 Google 授權後跳轉回來
  if (e.parameter.code) {
    return processOAuthCallback(e.parameter.code);
  } else {
    // 渲染首頁，如果有 session_token 參數，就傳給前端樣板
    var template = HtmlService.createTemplateFromFile('Index');
    template.sessionToken = e.parameter.session_token || '';
    template.appUrl = getAppUrl();

    // 取得前端動態渲染參數 (自全域 UI_CONFIG 載入)
    template.schoolName = UI_CONFIG.schoolName;
    template.schoolAddress = UI_CONFIG.schoolAddress;
    template.schoolPhone = UI_CONFIG.schoolPhone;
    template.systemTitle = UI_CONFIG.systemTitle;
    template.systemDesc = UI_CONFIG.systemDesc;
    template.logoId = UI_CONFIG.logoId;
    template.allowedDomain = ALLOWED_DOMAIN;

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

    // 3. 產生專屬 Session Token 並寫入 Cache (保存 30 分鐘 = 1800 秒，考量公用電腦安全性)
    const sessionToken = Utilities.getUuid();
    CacheService.getScriptCache().put('session_' + sessionToken, JSON.stringify(profile), 1800);

    // 4. 回傳一段腳本，讓整個畫面導向帶有 Token 的網址
    var appUrl = getAppUrl();
    var redirectUrl = appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + 'session_token=' + encodeURIComponent(sessionToken);

    var html = '<!DOCTYPE html>\n'
      + '<html lang="zh-TW"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>\u767b\u5165\u6210\u529f<\/title>'
      + '<style>'
      + '*{box-sizing:border-box;margin:0;padding:0}'
      + 'body{background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
      + '.card{background:#fff;padding:2.5rem 2rem;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center;max-width:360px;width:calc(100% - 2rem)}'
      + '.icon{width:4rem;height:4rem;background:#dcfce7;color:#16a34a;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem}'
      + 'h2{font-size:1.5rem;font-weight:700;color:#1e293b;margin-bottom:.5rem}'
      + 'p{color:#64748b;font-size:.95rem;margin-bottom:1.75rem;line-height:1.6}'
      + 'a.btn{display:block;width:100%;padding:.85rem;background:#2563eb;color:#fff;font-size:1rem;font-weight:600;border-radius:.6rem;text-decoration:none;transition:background .2s}'
      + 'a.btn:hover{background:#1d4ed8}'
      + '#st{font-size:.8rem;color:#94a3b8;margin-top:1rem}'
      + '<\/style><\/head><body>'
      + '<div class="card">'
      + '<div class="icon"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"\/><\/svg><\/div>'
      + '<h2>\u767b\u5165\u6210\u529f\uff01<\/h2>'
      + '<p>\u767b\u5165\u8a8d\u8b49\u5b8c\u6210\uff01\u6b63\u5728\u901a\u77e5\u7cfb\u7d71\uff0c\u8acb\u7a0d\u5019\u2026<br>\u5982\u672a\u81ea\u52d5\u5b8c\u6210\uff0c\u8acb\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u3002<\/p>'
      + '<a id="go" href="' + redirectUrl + '" target="_top" class="btn">\u8fd4\u56de\u7cfb\u7d71\u4e3b\u9801<\/a>'
      + '<div id="st"><\/div>'
      + '<\/div>'
      + '<script>(function(){'
      + 'var tk="' + sessionToken + '";'
      + 'function send(){'
      + 'try{localStorage.setItem("gas_auth_result",JSON.stringify({token:tk,ts:Date.now()}));}catch(ls){}'
      + 'try{if(window.opener&&!window.opener.closed){window.opener.postMessage({type:"gas_oauth_token",token:tk},"*");}}catch(e1){}'
      + 'try{if(window.parent!==window){window.parent.postMessage({type:"gas_oauth_token",token:tk},"*");}}catch(e2){}'
      + 'var btn=document.getElementById("go");'
      + 'if(btn){btn.href="#";btn.onclick=function(e){e.preventDefault();try{localStorage.setItem("gas_auth_result",JSON.stringify({token:tk,ts:Date.now()}));}catch(ls){}try{window.close();}catch(x){btn.textContent="\u767b\u5165\u5b8c\u6210\uff01\u8acb\u624b\u52d5\u95dc\u9589\u6b64\u8996\u7a97";btn.style.background="#6b7280";}};}'
      + 'setTimeout(function(){try{window.close();}catch(x){}},1800);'
      + '}'
      + 'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",send);}else{send();}'
      + '})();<\/script>'
      + '<\/body><\/html>';
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
    var email = (profile.email || '').trim();
    var displayName = profile.name || email.split('@')[0];

    // 嚴格檢查：必須屬於 ALLOWED_DOMAIN 才能登入
    if (!ALLOWED_DOMAIN || ALLOWED_DOMAIN === '請設定 ALLOWED_DOMAIN') {
      return { loggedIn: true, email: email, displayName: displayName, role: "invalid", message: "系統尚未設定允許登入的組織網域 (ALLOWED_DOMAIN)" };
    }
    
    if (!email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN.toLowerCase().trim())) {
      return { loggedIn: true, email: email, displayName: displayName, role: "invalid", message: "非允許登入的組織網域，僅限 @" + ALLOWED_DOMAIN + " 帳號使用" };
    }

    // 優先判定為管理員
    if (isAdminUser(email)) {
      return { loggedIn: true, email: email, displayName: displayName, role: "admin", picture: profile.picture };
    }

    // 檢查是否為學生帳號 (六位數字)
    if (isStudentAccount(email)) {
      return { loggedIn: true, email: email, displayName: displayName, role: "student", message: "學生帳號僅開放「設備借用」與「自然科實驗室預約」，無權限進行藥品請購與設備申請。" };
    }

    // 通過網域檢查且非學生、非管理員，即為一般教職員帳號
    return { loggedIn: true, email: email, displayName: displayName, role: "teacher", picture: profile.picture };
  } catch (e) {
    return { loggedIn: false, email: "", role: "guest", loginUrl: getLoginUrl() };
  }
}

// =====================================================================
// 【ZONE 4】前台表單收件與寫入控制模組 (Application Form Submissions)
// =====================================================================

// 處理藥品/物品 批次請購表單提交
function batchSubmitApplication(formDataArray, token) {
  formDataArray = sanitizeFormData(formDataArray);
  try {
    for (var i = 0; i < formDataArray.length; i++) {
      validateChemFormData(formDataArray[i]);
    }
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    if (isStudentAccount(email)) {
      return { success: false, message: '提交失敗：學生帳號無權限使用此功能！' };
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

    var rowsToInsert = [];
    var now = new Date();
    var photoUrl = '無照片';

    for (var i = 0; i < formDataArray.length; i++) {
      var fd = formDataArray[i];
      rowsToInsert.push([
        now,
        fd.chineseName || '',
        fd.englishName || '',
        fd.quantity || '',
        fd.category || '',
        fd.concentration || '',
        fd.usageTime || '',
        fd.subject || '',
        applicant,
        email,
        photoUrl,
        fd.volume || '',
        '', // 是否請購
        fd.remark || '',
        ''  // 採購總價
      ]);
    }

    if (rowsToInsert.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);
    }

    return { success: true, message: '成功匯入 ' + rowsToInsert.length + ' 筆請購資料！' };
  } catch (e) {
    throw new Error('批次送出失敗: ' + e.message);
  }
}

// 處理藥品/物品請購表單提交（含圖片解碼與儲存）
function submitApplication(formData, token) {
  formData = sanitizeFormData(formData);
  try {
    validateChemFormData(formData);
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    // 阻擋帳號防護 (後端二次檢查)
    if (isStudentAccount(email)) {
      return { success: false, message: '提交失敗：學生帳號無權限使用此功能！' };
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

    // 處理圖片上傳
    var photoUrl = saveBase64ImageToDrive_(formData.photoBase64, formData.photoName);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: '提交失敗：系統目前忙碌中，請稍後再試。' };
    }

    try {
      var rowDataMap = {
        '時間戳記': new Date(),
        '物品/藥品中文名稱': formData.chineseName,
        '藥品英文名稱(含化學式，分子量)或物品名稱': formData.englishName,
        '所需數量': formData.quantity,
        '物品分類/化學藥品狀態': formData.category,
        '藥品濃度(液態)': formData.concentration || '無',
        '課程使用時間': formData.usageTime,
        '請勾選所需科別': formData.subject,
        '申請人': applicant,
        '電子郵件地址': formData.email,
        '物品/藥品照片': photoUrl,
        '藥品容量(液態)': formData.volume || '無',
        '是否請購': '未請購',
        '備註': formData.remark || '',
        '採購總價': ''
      };

      appendRowFromMap_(sheet, rowDataMap);

      CacheService.getScriptCache().remove('sheet_data_cache_v2_chem');
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

// 處理設備借用表單提交
function submitEquipBorrowApplication(formData, token) {
  formData = sanitizeFormData(formData);
  try {
    validateEquipBorrowFormData(formData);
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    // 設備借用開放學生帳號申請，不進行 isStudentAccount 阻擋

    var applicant = (profile.name || formData.applicant || email.split('@')[0] || '').toString();

    var ss = SpreadsheetApp.openById(EQUIP_BORROW_SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '日期時間', '科室', '物品', '數量', '借用人', '借用說明', '是否歸還', '備註', '電子郵件', '照片'
      ]);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: '提交失敗：系統目前忙碌中，請稍後再試。' };
    }

    try {
      var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];

      // 確保標題列有「電子郵件」與「照片」，如果沒有就自動補上
      if (headers.indexOf('電子郵件') === -1) {
        var newColIndex = headers.length + 1;
        sheet.getRange(1, newColIndex).setValue('電子郵件');
        headers.push('電子郵件');
      }
      if (headers.indexOf('照片') === -1) {
        var newColIndex = headers.length + 1;
        sheet.getRange(1, newColIndex).setValue('照片');
        headers.push('照片');
      }

      // 處理照片上傳
      var photoUrl = saveBase64ImageToDrive_(formData.photoBase64, formData.photoName);

      var rowDataMap = {
        '日期時間': new Date(),
        '科室': formData.department,
        '物品': formData.item,
        '數量': formData.quantity,
        '借用人': applicant,
        '借用說明': formData.purpose,
        '是否歸還': '未歸還',
        '備註': formData.remark || '',
        '電子郵件': email,
        '照片': photoUrl
      };

      appendRowFromMap_(sheet, rowDataMap, headers);

      CacheService.getScriptCache().remove('sheet_data_cache_v2_equipBorrow');
    } finally {
      lock.releaseLock();
    }

    try {
      var subjectStr = "【新設備借用申請通知】" + formData.item;
      var bodyStr = "系統收到一筆新的設備借用申請：\n\n" +
        "借用人：" + applicant + "\n" +
        "科室：" + formData.department + "\n" +
        "借用物品：" + formData.item + "\n" +
        "數量：" + formData.quantity + "\n" +
        "借用說明：" + formData.purpose + "\n\n" +
        "請登入系統管理者後台查看詳細內容： " + ADMIN_BACKEND_URL;

      MailApp.sendEmail(ADMIN_EMAILS.join(","), subjectStr, bodyStr, {
        name: "自然科採購與借用系統"
      });
    } catch (e) {
      console.log("Email發送失敗: " + e.toString());
    }

    return { success: true, message: '設備借用申請已成功送出！' };
  } catch (error) {
    return { success: false, message: '後端錯誤: ' + error.toString() };
  }
}

// 處理設備採購表單提交
function submitEquipApplication(formData, token) {
  formData = sanitizeFormData(formData);
  try {
    validateEquipFormData(formData);
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '提交失敗：您必須登入學校網域帳號 (@' + ALLOWED_DOMAIN + ') 才能進行申請！' };
    }

    if (isStudentAccount(email)) {
      return { success: false, message: '提交失敗：學生帳號無權限使用此功能！' };
    }

    var applicant = (profile.name || email.split('@')[0] || '').toString();

    var ss = SpreadsheetApp.openById(EQUIP_SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '時間戳記', '電子郵件地址', '申請人', '申請科別', '設備名稱/軟體名稱',
        '數量', '自估單價', '需求及用途說明', '是否為課綱表定設備',
        '設備或軟體存置地點', '對應科別', '是否購入', '備註', '採購總價', '照片'
      ]);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: '提交失敗：系統目前忙碌中，請稍後再試。' };
    }

    try {
      var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];

      // 確保標題列有「照片」，如果沒有就自動補上
      if (headers.indexOf('照片') === -1) {
        var newColIndex = headers.length + 1;
        sheet.getRange(1, newColIndex).setValue('照片');
        headers.push('照片');
      }

      // 處理照片上傳
      var photoUrl = saveBase64ImageToDrive_(formData.photoBase64, formData.photoName);

      var rowDataMap = {
        '時間戳記': new Date(),
        '電子郵件地址': email,
        '申請人': applicant,
        '申請科別': formData.applySubject,
        '設備名稱/軟體名稱': formData.equipName,
        '數量': formData.quantity,
        '自估單價': formData.price,
        '需求及用途說明': formData.purpose,
        '是否為課綱表定設備': formData.isSyllabus,
        '設備或軟體存置地點': formData.location,
        '對應科別': formData.correspondSubject,
        '是否購入': '未購入',
        '是否請購': '未購入', // 相容舊標題
        '備註': '',
        '採購總價': '',
        '照片': photoUrl
      };

      appendRowFromMap_(sheet, rowDataMap, headers);

      CacheService.getScriptCache().remove('sheet_data_cache_v2_equip');
    } finally {
      lock.releaseLock();
    }

    try {
      var subjectStr = "【新設備採購申請通知】" + formData.equipName;
      var bodyStr = "系統收到一筆新的設備採購申請：\n\n" +
        "申請人：" + applicant + "\n" +
        "申請科別：" + formData.applySubject + "\n" +
        "設備名稱：" + formData.equipName + "\n" +
        "數量：" + formData.quantity + "\n" +
        "對應科別：" + formData.correspondSubject + "\n" +
        "地點：" + formData.location + "\n\n" +
        "請登入系統管理者後台查看詳細內容並進行審核： " + ADMIN_BACKEND_URL;

      MailApp.sendEmail(ADMIN_EMAILS.join(","), subjectStr, bodyStr, {
        name: "自然科採購系統"
      });
    } catch (e) {
      console.log("Email發送失敗: " + e.toString());
    }

    return { success: true, message: '設備需求申請已成功送出！' };
  } catch (error) {
    return { success: false, message: '後端錯誤: ' + error.toString() };
  }
}

// =====================================================================
// 【ZONE 5】資料檢視與管理員進階控制 (Data Retrieval & Admin Actions)
// =====================================================================

// 供管理者介面讀取所有資料
function getAdminData(token, system) {
  try {
    var profile = verifySessionToken(token);
    if (!isAdminUser(profile.email)) {
      throw new Error("權限不足：您的帳號無管理員權限！");
    }

    return getSheetData(system);
  } catch (error) {
    throw new Error(error.message || "載入資料失敗");
  }
}

// 供一般使用者讀取自己的資料
function getUserData(token, system) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!email || !email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) {
      return [];
    }
    var normalizedEmail = email.toLowerCase().trim();
    var applicantName = (profile.name || email.split('@')[0]).toLowerCase().trim();

    return getSheetData(system).filter(function (item) {
      var itemEmail = String(item.email || '').toLowerCase().trim();
      var itemApplicant = String(item.applicant || '').toLowerCase().trim();
      return itemEmail === normalizedEmail ||
        (itemEmail === '' && (itemApplicant === applicantName || itemApplicant === normalizedEmail.split('@')[0]));
    });
  } catch (error) {
    return [];
  }
}

// 更新特定的請購狀態與總價 (限管理員)
function updateProcurementStatus(rowNumber, newStatus, totalPrice, token, system) {
  return batchUpdateProcurementStatus([{ rowNumber: rowNumber, newStatus: newStatus, totalPrice: totalPrice }], token, system);
}

// 批次更新請購狀態與總價 (限管理員)
function batchUpdateProcurementStatus(updates, token, system) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '操作失敗：系統目前忙碌中，請稍後再試。' };
  }

  try {
    var profile = verifySessionToken(token);
    if (!isAdminUser(profile.email)) {
      return { success: false, message: '操作失敗：您無權執行此操作！' };
    }

    var sheet = getSystemSheet_(system);

    var headers = sheet.getRange(1, 1, 1, Math.max(15, sheet.getLastColumn())).getValues()[0];

    // 對應可能為「是否請購」、「是否購入」或「是否歸還」
    var statusColIdx = headers.indexOf('是否請購');
    if (statusColIdx === -1) statusColIdx = headers.indexOf('是否購入');
    if (statusColIdx === -1) statusColIdx = headers.indexOf('是否歸還');
    statusColIdx = statusColIdx !== -1 ? statusColIdx + 1 : 13;

    var priceColIdx = headers.indexOf('採購總價');
    if (priceColIdx === -1) priceColIdx = headers.indexOf('自估單價');
    if (priceColIdx === -1) priceColIdx = headers.indexOf('備註');
    priceColIdx = priceColIdx !== -1 ? priceColIdx + 1 : 15;

    updates.forEach(function (u) {
      sheet.getRange(u.rowNumber, statusColIdx).setValue(u.newStatus);
      if (u.totalPrice !== undefined && u.totalPrice !== '') {
        sheet.getRange(u.rowNumber, priceColIdx).setValue(u.totalPrice);
      }
    });

    CacheService.getScriptCache().remove('sheet_data_cache_v2_' + (system || 'chem'));
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// 供一般使用者刪除（取消）屬於自己的請購紀錄
function deleteUserRequests(rowNumbers, token, system) {
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

    var sheet = getSystemSheet_(system);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, message: '找不到資料表內容。' };

    var headers = data[0];
    var emailColIdx = headers.indexOf('電子郵件地址');
    if (emailColIdx === -1) emailColIdx = headers.indexOf('電子郵件');
    if (emailColIdx === -1) emailColIdx = headers.indexOf('email');
    if (emailColIdx === -1 && system === 'chem') emailColIdx = 9;
    if (emailColIdx === -1 && system === 'equip') emailColIdx = 1;

    var applicantColIdx = headers.indexOf('申請人');
    if (applicantColIdx === -1) applicantColIdx = headers.indexOf('借用人');
    if (applicantColIdx === -1 && system === 'chem') applicantColIdx = 8;
    if (applicantColIdx === -1 && system === 'equip') applicantColIdx = 2;

    var normalizedEmail = email.toLowerCase().trim();
    var applicantName = (profile.name || email.split('@')[0]).toLowerCase().trim();

    rowNumbers.sort(function (a, b) { return b - a; });

    for (var i = 0; i < rowNumbers.length; i++) {
      var rowNum = rowNumbers[i];
      if (rowNum < 2 || rowNum > data.length) {
        throw new Error('無效的列號：' + rowNum);
      }

      var rowEmail = emailColIdx !== -1 ? String(data[rowNum - 1][emailColIdx] || '').toLowerCase().trim() : '';
      var rowApplicant = applicantColIdx !== -1 ? String(data[rowNum - 1][applicantColIdx] || '').toLowerCase().trim() : '';

      var isOwner = (rowEmail !== '' && rowEmail === normalizedEmail) ||
        (rowEmail === '' && (rowApplicant === applicantName || rowApplicant === normalizedEmail.split('@')[0]));

      if (isOwner) {
        sheet.deleteRow(rowNum);
      } else {
        throw new Error('安全性錯誤：您無權刪除其他人的請購項目！');
      }
    }

    // 清除快取，讓下次讀取能抓到最新資料
    CacheService.getScriptCache().remove('sheet_data_cache_v2_' + (system || 'chem'));
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

// ====== 設定圖片上傳 ======
function uploadLogoImage(base64Data, contentType, photoName, token) {
  try {
    var status = getAuthStatus(token);
    if (!status.loggedIn || status.role !== 'admin') {
      throw new Error('安全性錯誤：您無權限上傳圖片');
    }

    var folderId = UPLOAD_FOLDER_ID;
    if (!folderId) throw new Error('未設定上傳資料夾 (FOLDER_ID)');

    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, photoName);
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { success: true, fileId: file.getId() };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// ====== 輔助函式 ======

function getSystemSheet_(system) {
  var targetSheetId = SPREADSHEET_ID;
  if (system === 'equip') {
    targetSheetId = EQUIP_SHEET_ID;
  } else if (system === 'equipBorrow') {
    targetSheetId = EQUIP_BORROW_SHEET_ID;
  }
  var ss = SpreadsheetApp.openById(targetSheetId);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function saveBase64ImageToDrive_(base64Str, fileName) {
  if (!base64Str || !fileName) return '無照片';
  var splitData = base64Str.split(',');
  var contentType = splitData[0].split(':')[1].split(';')[0];
  var base64Data = splitData[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, fileName);
  var folder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function appendRowFromMap_(sheet, rowDataMap, customHeaders) {
  var headers = customHeaders || sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var newRow = new Array(headers.length);
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    newRow[i] = rowDataMap.hasOwnProperty(header) ? rowDataMap[header] : '';
  }
  sheet.appendRow(newRow);
}

function formatLabDate_(val, timeZone) {
  if (!val) return "";
  var dateObj = new Date(val);
  if (!isNaN(dateObj) && val !== "") {
    return Utilities.formatDate(dateObj, timeZone, "yyyy-MM-dd");
  }
  return String(val).trim().split("T")[0].replace(/\//g, "-");
}

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
    var idx = colMap[colName];
    if (idx === undefined) idx = defaultIdx;
    return row[idx] !== undefined ? row[idx] : '';
  };
  return {
    rowNumber: index + 2,
    timestamp: formatDateOnly(getVal('時間戳記', -1) || getVal('日期時間', 0)),
    chineseName: getVal('物品/藥品中文名稱', -1) || getVal('設備名稱/軟體名稱', -1) || getVal('設備名稱', -1) || getVal('物品', -1),
    englishName: getVal('藥品英文名稱(含化學式，分子量)或物品名稱', 2),
    quantity: getVal('所需數量', -1) || getVal('數量', -1),
    category: getVal('物品分類/化學藥品狀態', 4),
    concentration: getVal('藥品濃度(液態)', 5),
    usageTime: formatDateTime(getVal('課程使用時間', 6)),
    subject: getVal('請勾選所需科別', -1) || getVal('申請科別', -1) || getVal('科室', -1),
    applicant: getVal('申請人', -1) || getVal('借用人', 8),
    email: getVal('電子郵件', -1) || getVal('電子郵件地址', 9),
    photoUrl: getVal('照片', -1) || getVal('物品/藥品照片', 10) || '無照片',
    volume: getVal('單瓶容量(液體)', 11),
    isSyllabus: getVal('是否為課綱表定設備', -1),
    location: getVal('設備或軟體存置地點', -1),
    correspondSubject: getVal('對應科別', -1),
    status: (function () {
      var s = getVal('是否購入', -1) || getVal('是否請購', -1) || getVal('是否歸還', -1) || '';
      if (s === '是') return '已購入';
      if (s === '否') return '未購入';
      return s || (getVal('是否歸還', -1) ? '未歸還' : (getVal('設備名稱/軟體名稱', -1) ? '未購入' : '未請購'));
    })(),
    remark: getVal('備註', 13),
    totalPrice: getVal('採購總價', 14),
    price: getVal('自估單價', -1), // 給教學設備專用的單價欄位
    purpose: getVal('需求及用途說明', -1) || getVal('借用說明', -1)
  };
}

// =====================================================================
// 【ZONE 6】底層試算表存取引擎與資料轉換映射 (Spreadsheet Engine & Caching)
// =====================================================================

function getSheetData(system) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'sheet_data_cache_v2_' + (system || 'chem');
  var cachedData = cache.get(cacheKey);
  if (cachedData) {
    try { return JSON.parse(cachedData); } catch (e) { }
  }

  var sheet = getSystemSheet_(system); // 如果找不到 SHEET_NAME，預設取第一張表
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
    // 快取 5 分鐘 (300秒，平衡讀取效能與資料即時性)
    cache.put(cacheKey, JSON.stringify(reversedData), 300);
  } catch (e) { }

  return reversedData;
}

// =====================================================================
// 【ZONE 8】後台系統屬性安裝與自訂 UI 設定 (System Properties & Settings)
// =====================================================================
/**
 * 首次建置環境或轉移環境時，可於編輯器內執行此函式
 * 以便將環境變數寫入 PropertiesService 中
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    // 【必填】存放申請表單資料的 Google 試算表 ID (從網址中擷取)
    'SPREADSHEET_ID': '請填入 SPREADSHEET_ID',         // 藥品/物品請購 試算表ID
    'EQUIP_SHEET_ID': '請填入 EQUIP_SHEET_ID',         // 設備申請 試算表ID
    'EQUIP_BORROW_SHEET_ID': '請填入 EQUIP_BORROW_SHEET_ID',  // 設備借用 試算表ID
    'LAB_SPREADSHEET_ID': '請填入 LAB_SPREADSHEET_ID',     // 實驗室預約 試算表ID

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

// ====== 系統設定管理 ======

function getSystemSettings(token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!isAdminUser(email)) {
      throw new Error('權限不足：只有管理者可讀取系統設定');
    }
    return { success: true, data: PropertiesService.getScriptProperties().getProperties() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function saveSystemSettings(settingsObj, token) {
  try {
    var profile = verifySessionToken(token);
    var email = profile.email;
    if (!isAdminUser(email)) {
      throw new Error('權限不足：只有管理者可修改系統設定');
    }
    PropertiesService.getScriptProperties().setProperties(settingsObj, false);
    return { success: true, message: '系統設定已成功更新！請重新載入網頁以套用變更。' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}


// 樣板引入 Helper (屬 ZONE 3 渲染導覽之一部)
function include(filename, data) {
  var template = HtmlService.createTemplateFromFile(filename);

  // 載入全域環境變數 (自全域 UI_CONFIG 載入)
  template.schoolName = UI_CONFIG.schoolName;
  template.schoolAddress = UI_CONFIG.schoolAddress;
  template.schoolPhone = UI_CONFIG.schoolPhone;
  template.systemTitle = UI_CONFIG.systemTitle;
  template.systemDesc = UI_CONFIG.systemDesc;
  template.logoId = UI_CONFIG.logoId;
  template.allowedDomain = ALLOWED_DOMAIN;

  // 若前端有傳入 this (包含 sessionToken 等動態變數)，則一併繼承
  if (data) {
    for (var key in data) {
      template[key] = data[key];
    }
  }

  return template.evaluate().getContent();
}

// =====================================================================
// 【ZONE 7】自然科實驗室預約獨立核心業務 (Lab Booking Subsystem)
// =====================================================================

function getLabData() {
  try {
    const ss = SpreadsheetApp.openById(LAB_SPREADSHEET_ID);

    // 1. 取得教室資料 (資料表2 = 可預約教室列表)
    const roomSheet = ss.getSheetByName(SHEET_NAME_LAB_ROOMS);
    let rooms = [];
    if (roomSheet) {
      const roomData = roomSheet.getDataRange().getValues();
      for (let i = 1; i < roomData.length; i++) {
        if (!roomData[i][0]) continue;
        rooms.push({
          id: roomData[i][0],
          name: roomData[i][1],
          location: roomData[i][2],
          capacity: roomData[i][3],
          floor: String(roomData[i][4] || '').trim(),
          image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&q=80&w=100&h=100'
        });
      }
    }

    // 2. 取得節次資料 (資料表3 = 時間節數對應表)
    const periodSheet = ss.getSheetByName(SHEET_NAME_LAB_PERIODS);
    let periods = [];
    if (periodSheet) {
      const periodData = periodSheet.getDataRange().getValues();
      for (let i = 1; i < periodData.length; i++) {
        if (!periodData[i][0]) continue;
        let timeRange = periodData[i][1] || '';
        let times = timeRange.split('-');
        let start = times[0] ? times[0].trim() : '00:00';
        let end = times[1] ? times[1].trim() : '00:00';
        periods.push({
          name: periodData[i][0],
          start: start,
          end: end
        });
      }
    }

    // 3. 取得預約資料 (資料表1 = 表單回應 1)
    const bookingSheet = ss.getSheetByName(SHEET_NAME);
    let bookings = [];
    if (bookingSheet) {
      const bookingData = bookingSheet.getDataRange().getValues();
      for (let i = 1; i < bookingData.length; i++) {
        let row = bookingData[i];
        if (!row[0]) continue;

        let dateStr = formatLabDate_(row[4], ss.getSpreadsheetTimeZone());

        let periodStr = String(row[5]);
        let startT = '08:00';
        let endT = '09:00';
        if (periods.length > 0 && periodStr) {
          let ps = periodStr.split(',').map(function (s) { return s.trim(); });
          let firstP = periods.filter(function (p) { return p.name === ps[0]; })[0];
          let lastP = periods.filter(function (p) { return p.name === ps[ps.length - 1]; })[0];
          if (firstP) startT = firstP.start;
          if (lastP) endT = lastP.end;
        }

        bookings.push({
          rowNumber: i + 1,
          email: String(row[1] || '').toLowerCase().trim(),
          teacher: String(row[3] || '').trim(),
          student: String(row[12] || '').trim(),
          roomId: row[6],
          start: startT,
          end: endT,
          title: row[7],
          user: row[3] || row[12] || '申請者',
          date: dateStr,
          periodsList: periodStr,
          chemicals: row[8] || '無',
          equipment: row[9] || '無',
          courseType: String(row[10] || '無').trim(),
          capacity: String(row[11] || '').trim(),
          className: String(row[2] || '').trim(),
          groupId: String(row[14] || '').trim(),
          color: 'bg-indigo-500'
        });
      }
    }

    let weeklyBookings = {};
    const dayMap = { 0: '週日', 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五', 6: '週六' };
    bookings.forEach(function (b) {
      let d = new Date(b.date);
      if (!isNaN(d)) {
        let dayStr = dayMap[d.getDay()];
        let rId = String(b.roomId).trim();
        if (!weeklyBookings[rId]) weeklyBookings[rId] = {};
        weeklyBookings[rId][dayStr] = (weeklyBookings[rId][dayStr] || 0) + 1;

        rooms.forEach(function (r) {
          if (String(r.id).trim() === rId || String(r.name).trim() === rId || String(r.name).trim().indexOf(rId) !== -1) {
            let realId = String(r.id).trim();
            if (!weeklyBookings[realId]) weeklyBookings[realId] = {};
            if (realId !== rId) {
              weeklyBookings[realId][dayStr] = (weeklyBookings[realId][dayStr] || 0) + 1;
            }
          }
        });
      }
    });

    return {
      rooms: rooms,
      periods: periods,
      bookings: bookings,
      weeklyBookings: weeklyBookings
    };

  } catch (e) {
    throw new Error('取得資料失敗: ' + e.message);
  }
}

function submitLabBooking(data, token) {
  data = sanitizeFormData(data);
  try {
    validateLabBookingData(data);
    const ss = SpreadsheetApp.openById(LAB_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('找不到表單回應 1');

    let email = '';
    if (token) {
      try {
        var profile = verifySessionToken(token);
        email = profile.email || '';
      } catch (e) { }
    }
    if (!email && data && data.email) {
      email = data.email;
    }
    if (!email) {
      try { email = Session.getActiveUser().getEmail(); } catch (e) { }
    }

    // 準備要預約的日期陣列
    let datesToBook = [];
    let startD = new Date(data['使用日期']);
    datesToBook.push(startD);

    let isRecurring = data.isRecurring === true || data.isRecurring === 'true';
    let endDateStr = data.endDate;
    if (isRecurring && endDateStr) {
      let endD = new Date(endDateStr);
      let nextD = new Date(startD);
      nextD.setDate(nextD.getDate() + 7);
      while (nextD <= endD) {
        datesToBook.push(new Date(nextD));
        nextD.setDate(nextD.getDate() + 7);
      }
    }

    // 取得現有預約資料進行防衝堂檢查
    const existingData = sheet.getDataRange().getValues();
    // 取出所有現存預約的 (日期_實驗室_節次) 作為 Set
    const bookedSet = new Set();
    for (let i = 1; i < existingData.length; i++) {
      let r = existingData[i];
      if (!r[0]) continue; // 空列
      let rDateStr = formatLabDate_(r[4], ss.getSpreadsheetTimeZone());
      let rPeriods = String(r[5]).split(',').map(function (s) { return s.trim(); });
      let rRoom = String(r[6]).trim();
      rPeriods.forEach(function (p) {
        if (p) bookedSet.add(rDateStr + "_" + rRoom + "_" + p);
      });
    }

    const requestedPeriods = (data['使用節次'] || '').split(',').map(function (s) { return s.trim(); });
    const reqRoom = String(data['使用實驗室'] || '').trim();
    let conflicts = [];
    let groupId = isRecurring ? Utilities.getUuid() : '';

    // 逐一檢查每一個欲預約的日期與節次
    for (let i = 0; i < datesToBook.length; i++) {
      let curD = datesToBook[i];
      let curDateStr = Utilities.formatDate(curD, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
      let validPeriods = [];

      requestedPeriods.forEach(function (p) {
        if (!p) return;
        let key = curDateStr + "_" + reqRoom + "_" + p;
        if (bookedSet.has(key)) {
          conflicts.push({ date: curDateStr, period: p });
        } else {
          validPeriods.push(p);
        }
      });

      // 只有當該日期有未衝堂的節次時，才寫入一筆
      if (validPeriods.length > 0) {
        const row = [
          new Date(),
          email,
          data['使用班級'] || '',
          data['申請教師'] || '',
          curD,
          validPeriods.join(','),
          data['使用實驗室'] || '',
          data['實驗名稱/課程內容'] || '',
          data['實驗所需化學藥品'] || '',
          data['實驗所需器材'] || '',
          data['使用型態'] || '',
          data['人數'] || '',
          data['申請學生'] || '',
          '', // 第14欄預留
          groupId // 第15欄: groupId
        ];
        sheet.appendRow(row);
      }
    }

    return { success: true, conflicts: conflicts };
  } catch (e) {
    throw new Error('送出預約失敗: ' + e.message);
  }
}

// 取消教室預約紀錄
function cancelLabBooking(rowNumber, token, cancelSeries) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '系統目前忙碌中，請稍後再試。' };
  }

  try {
    var profile = verifySessionToken(token);
    var email = (profile.email || '').toLowerCase().trim();
    if (!email || !email.endsWith('@' + ALLOWED_DOMAIN)) {
      return { success: false, message: '操作失敗：驗證身分失敗，請先以學校網域帳號登入。' };
    }

    var isAdmin = isAdminUser(email);
    var applicantName = (profile.name || email.split('@')[0]).toLowerCase().trim();

    const ss = SpreadsheetApp.openById(LAB_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return { success: false, message: '找不到' + SHEET_NAME + '資料表。' };

    var data = sheet.getDataRange().getValues();
    if (rowNumber < 2 || rowNumber > data.length) {
      return { success: false, message: '找不到該筆預約紀錄（無效的列號：' + rowNumber + '）。可能該紀錄已遭刪除。' };
    }

    var row = data[rowNumber - 1];
    var rowEmail = String(row[1] || '').toLowerCase().trim();
    var rowTeacher = String(row[3] || '').toLowerCase().trim();
    var rowStudent = String(row[12] || '').toLowerCase().trim();
    var rowUser = rowTeacher || rowStudent;

    var isOwner = (rowEmail !== '' && rowEmail === email) ||
      (rowUser !== '' && (rowUser === applicantName || rowUser === email.split('@')[0])) ||
      (rowTeacher === applicantName || rowStudent === applicantName) ||
      (rowTeacher === email.split('@')[0] || rowStudent === email.split('@')[0]);

    if (!isAdmin && !isOwner) {
      return { success: false, message: '安全性錯誤：您沒有權限取消其他人（非本帳號）的預約！' };
    }

    var groupId = String(row[14] || '').trim();
    if (cancelSeries === true && groupId) {
      // 找出同 groupId 的所有列 (從後面刪除以避免列號偏移)
      var rowsToDelete = [];
      // 僅刪除「未來與當下(包含今天)」的預約，過去的不刪除
      var todayStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][14] || '').trim() === groupId) {
          var rDateStr = formatLabDate_(data[i][4], ss.getSpreadsheetTimeZone());
          if (rDateStr >= todayStr) {
            rowsToDelete.push(i + 1); // 1-indexed
          }
        }
      }
      rowsToDelete.sort(function (a, b) { return b - a; });
      rowsToDelete.forEach(function (rn) {
        sheet.deleteRow(rn);
      });
    } else {
      sheet.deleteRow(rowNumber);
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}
