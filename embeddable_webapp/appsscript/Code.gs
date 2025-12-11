
function doGet(e) {
  var token = (e.parameter.token || '').trim();
  var allowedOrigins = [
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'https://tomato.yujing.me/mgmt',  // 加入您的正式網域
    'https://procura.yujing.me/mgmt'
  ];

  var user = verifyToken_(token, allowedOrigins);
  if (!user) {
    // 驗證失敗
    return HtmlService.createHtmlOutput('<h3>未授權存取</h3>')
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