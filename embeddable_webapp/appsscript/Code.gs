/**
 * 設定 Google Sheet ID
 * 請在 Apps Script 專案屬性中設定 SHEET_ID
 */
function getSheet_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) {
    throw new Error('請在專案屬性中設定 SHEET_ID');
  }
  
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('Users') || ss.insertSheet('Users');
  
  // 確保有標題列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Username', 'Email', 'Created At', 'Status']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  
  return sheet;
}

function doGet(e) {
  var action = e.parameter.action || '';
  
  // 處理新增使用者的請求
  if (action === 'add_user') {
    return handleAddUser_(e);
  }
  
  // 一般 iframe 載入請求
  var token = (e.parameter.token || '').trim();
  var allowedOrigins = [
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'https://tomato.yujing.me/mgmt',
    'https://procura.yujing.me/mgmt'
  ];

  var user = verifyToken_(token, allowedOrigins);
  if (!user) {
    return HtmlService.createHtmlOutput('<h3>未授權存取</h3>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  // 檢查使用者是否存在於 Google Sheets
  if (!userExists_(user.userId)) {
    return HtmlService.createHtmlOutput('<h3>使用者不存在或已被停用</h3>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  // 驗證成功，把 userId 帶進頁面 (Template)
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.userId = user.userId;
  tpl.issuedAt = new Date(user.ts * 1000);

  return tpl
    .evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 處理新增使用者的請求
 */
function handleAddUser_(e) {
  var token = (e.parameter.token || '').trim();
  var username = (e.parameter.username || '').trim();
  var email = (e.parameter.email || '').trim();
  
  // 驗證管理員 token
  if (!verifyAdminToken_(token, username, email)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Invalid token'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    var sheet = getSheet_();
    
    // 檢查使用者是否已存在
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === username) {
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          message: 'User already exists'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 新增使用者
    sheet.appendRow([
      username,
      email,
      new Date().toISOString(),
      'active'
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'User added successfully'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 驗證管理員 token（用於新增使用者）
 */
function verifyAdminToken_(token, username, email) {
  if (!token) return false;

  var parts = token.split('.');
  if (parts.length !== 2) return false;

  var payloadB64 = parts[0];
  var sigB64 = parts[1];

  var payloadBytes, payloadStr;
  try {
    payloadBytes = Utilities.base64DecodeWebSafe(payloadB64);
    payloadStr = Utilities.newBlob(payloadBytes).getDataAsString();
  } catch (err) {
    return false;
  }

  var split = payloadStr.split('|');
  if (split.length !== 4) return false;

  var action = split[0];
  var tokenUsername = split[1];
  var tokenEmail = split[2];
  var tsStr = split[3];
  var ts = parseInt(tsStr, 10);

  if (action !== 'add_user' || tokenUsername !== username || tokenEmail !== email) {
    return false;
  }

  // 檢查是否過期（10 分鐘）
  var nowSec = Math.floor(new Date().getTime() / 1000);
  if (nowSec - ts > 600) {
    return false;
  }

  // 驗證簽章
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) return false;

  var data = action + '|' + tokenUsername + '|' + tokenEmail + '|' + tsStr;
  var hmacBytes = Utilities.computeHmacSha256Signature(data, secret);
  var expectedSigB64 = Utilities.base64EncodeWebSafe(hmacBytes).replace(/=+$/, '');

  return sigB64 === expectedSigB64;
}

/**
 * 檢查使用者是否存在且狀態為 active
 */
function userExists_(username) {
  try {
    var sheet = getSheet_();
    var data = sheet.getDataRange().getValues();
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === username && data[i][3] === 'active') {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    Logger.log('檢查使用者時發生錯誤: ' + error);
    return false;
  }
}

/**
 * 驗證 token：
 *  token 格式: payload_b64 + '.' + sig_b64
 *  payload = "userId|timestamp|origin" (UTF-8)，timestamp = epoch seconds
 *  sig = base64url( HMAC_SHA256(secret, payload) ).rstrip('=')
 */
function verifyToken_(token, allowedOrigins) {
  if (!token) return null;

  var parts = token.split('.');
  if (parts.length !== 2) return null;

  var payloadB64 = parts[0];
  var sigB64 = parts[1];

  // 解析 payload
  var payloadBytes, payloadStr;
  try {
    payloadBytes = Utilities.base64DecodeWebSafe(payloadB64);
    payloadStr = Utilities.newBlob(payloadBytes).getDataAsString(); // UTF-8
  } catch (err) {
    return null;
  }

  var split = payloadStr.split('|');
  if (split.length !== 3) return null;

  var userId = split[0];
  var tsStr = split[1];
  var origin = split[2];
  var ts = parseInt(tsStr, 10);
  if (!userId || !ts || isNaN(ts) || !origin) return null;

  // 檢查來源是否在允許清單中
  if (allowedOrigins.indexOf(origin) === -1) {
    return null;
  }

  // 檢查是否過期（例如 1 小時）
  var expiration_minutes = PropertiesService.getScriptProperties().getProperty('EXPIRATION_MINUTES');
  var nowSec = Math.floor(new Date().getTime() / 1000);
  var maxAgeSec = 60 * parseInt(expiration_minutes, 5); // 預設 5 分鐘
  if (nowSec - ts > maxAgeSec) {
    return null;
  }

  // 重新計算 signature
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) {
    throw new Error('沒有設定 SHARED_SECRET');
  }

  var data = userId + '|' + tsStr + '|' + origin;
  var hmacBytes = Utilities.computeHmacSha256Signature(data, secret);
  var expectedSigB64 = Utilities.base64EncodeWebSafe(hmacBytes).replace(/=+$/, '');

  if (sigB64 !== expectedSigB64) {
    return null;
  }

  return { userId: userId, ts: ts, origin: origin };
}