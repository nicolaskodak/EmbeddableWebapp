/* =========================================
   Module: Users 使用者管理
   ========================================= */
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
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 檢查使用者是否存在於 Google Sheets
  if (!userExists_(user.userId)) {
    return HtmlService.createHtmlOutput('<h3>使用者不存在或已被停用</h3>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 驗證成功，把 userId 帶進頁面 (Template)
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.userId = user.userId;
  tpl.issuedAt = new Date(user.ts * 1000);

  return tpl
    .evaluate()
    .setTitle('Tomato BOM 表資料工具')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  
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

/* =========================================
   Module: Store 門市對應關係管理
   ========================================= */
function getStoreSheet_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('STORE_SHEET_ID');
  if (!sheetId) {
    throw new Error('請在專案屬性中設定 STORE_SHEET_ID');
  }
  
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('data') || ss.insertSheet('data');
  
  // 確保有標題列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id', 'erp_customer_name', 'pos_store_name', 'address_zhtw', 'address_en', 'country', 'city', 'district', 'latitude', 'longitude', 'store_status', 'store_type']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }

  ensureStoreSheetSchema_(sheet);
  
  return sheet;
}

function ensureStoreSheetSchema_(sheet) {
  if (!sheet) return;

  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(['id', 'erp_customer_name', 'pos_store_name', 'address_zhtw', 'address_en', 'country', 'city', 'district', 'latitude', 'longitude', 'store_status', 'store_type']);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    return;
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });

  var idColIndex = headers.indexOf('id');
  if (idColIndex === -1) {
    idColIndex = headers.length;
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, idColIndex + 1).setValue('id').setFontWeight('bold');
    headers.push('id');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var idRange = sheet.getRange(2, idColIndex + 1, lastRow - 1, 1);
  var idValues = idRange.getValues();
  var changed = false;
  for (var i = 0; i < idValues.length; i++) {
    var v = String(idValues[i][0] || '').trim();
    if (!v) {
      idValues[i][0] = Utilities.getUuid();
      changed = true;
    }
  }
  if (changed) idRange.setValues(idValues);
}


/* 
-- pos, bom, erp
 */
const SHEET_ID = "1RLrJPHJ1RpUbTIQl1V4m0Wgh7j2IXo0-eRWQPmeALSk"; 

/* =========================================
   資料庫設定
   ========================================= */
const DB_CONFIG = {
  pos_items: { name: 'pos_items', cols: ['pos_item_id', 'pos_item_name', 'pos_option_group', 'pos_option_name', 'status'] },
  pos_item_mapping: { name: 'pos_item_mapping', cols: ['pos_item_mapping_id', 'pos_item_id', 'product_id'] },
  products: { name: 'products', cols: ['product_id', 'product_name', 'category_id'] },
  product_categories: { name: 'product_categories', cols: ['category_id', 'category_name'] },
  product_bom: { name: 'product_bom', cols: ['product_bom_id', 'product_id', 'ingredient_id', 'quantity', 'unit_id'] },
  semi_product_bom: { name: 'semi_product_bom', cols: ['semi_product_bom_id', 'semi_product_id', 'ingredient_id', 'quantity', 'unit_id'] },
  ingredients: { name: 'ingredients', cols: ['ingredient_id', 'ingredient_name', 'is_semi_product', 'purchase_source', 'erp_inventory_product_code'] },
  units: { name: 'units', cols: ['unit_id', 'unit_name'] },
  erp_inventory: { name: 'erp_inventory', cols: ['erp_inventory_id', 'product_code', 'erp_inventory_name', 'inventory_unit_id'] },
  unit_conversions: { name: 'unit_conversions', cols: ['id', 'erp_inventory_id', 'warehouse_in_unit_id', 'warehouse_in_quantity', 'warehouse_in_base_unit_id', 'warehouse_out_unit_id', 'warehouse_out_quantity', 'warehouse_out_base_unit_id'] }
};

function getSpreadsheet() {
  if (SHEET_ID && SHEET_ID.length > 20 && SHEET_ID !== "請將此處替換為您的_Google_Sheet_ID") {
    return SpreadsheetApp.openById(SHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getTableData(tableName) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(tableName);
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    const headers = data[0];
    const rows = data.slice(1);
    
    return rows.map(row => {
      let obj = {};
      headers.forEach((h, i) => { if(h) obj[h.trim()] = row[i]; });
      return obj;
    });
  } catch (e) {
    return [];
  }
}

function getMaxId(tableName, idColName) {
  const data = getTableData(tableName);
  if (data.length === 0) return 0;
  return Math.max(...data.map(d => Number(d[idColName]) || 0));
}

function insertRow(tableName, rowDataObj) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(tableName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = headers.map(h => rowDataObj[h.trim()] === undefined ? '' : rowDataObj[h.trim()]);
  sheet.appendRow(newRow);
  return true;
}

function updateRow(tableName, idColName, idValue, updateObj) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(tableName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idColIndex = headers.indexOf(idColName);
  if (idColIndex === -1) return false;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIndex]) === String(idValue)) {
      Object.keys(updateObj).forEach(key => {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) sheet.getRange(i + 1, colIndex + 1).setValue(updateObj[key]);
      });
      return true;
    }
  }
  return false;
}

function deleteRowByCondition(tableName, conditionFn) {
   const ss = getSpreadsheet();
   const sheet = ss.getSheetByName(tableName);
   const data = sheet.getDataRange().getValues();
   const headers = data[0];
   for(let i = data.length - 1; i >= 1; i--) {
     let rowObj = {};
     headers.forEach((h, idx) => rowObj[h.trim()] = data[i][idx]);
     if(conditionFn(rowObj)) {
       sheet.deleteRow(i + 1);
     }
   }
}

function deleteRowById(tableName, idColName, idValue) {
  return deleteRowByCondition(tableName, (row) => String(row[idColName]) === String(idValue));
}

/* =========================================
   Module A: POS 名稱對應
   ========================================= */
function getModuleAData() {
  const posItems = getTableData(DB_CONFIG.pos_items.name);
  const mapping = getTableData(DB_CONFIG.pos_item_mapping.name);
  const products = getTableData(DB_CONFIG.products.name);
  
  let mapIndex = {};
  mapping.forEach(m => {
    if(!mapIndex[m.pos_item_id]) mapIndex[m.pos_item_id] = [];
    mapIndex[m.pos_item_id].push(m.product_id);
  });
  
  const posData = posItems.map(p => {
    return {
      ...p,
      mapped_product_ids: mapIndex[p.pos_item_id] || []
    };
  });
  
  return { posItems: posData, products: products };
}

function savePosMapping(posItemId, productIdsArray) {
  deleteRowByCondition(DB_CONFIG.pos_item_mapping.name, (row) => String(row.pos_item_id) === String(posItemId));
  let currentMaxId = getMaxId(DB_CONFIG.pos_item_mapping.name, 'pos_item_mapping_id');
  productIdsArray.forEach(prodId => {
    if(prodId) {
      currentMaxId++;
      insertRow(DB_CONFIG.pos_item_mapping.name, {
        'pos_item_mapping_id': currentMaxId,
        'pos_item_id': posItemId,
        'product_id': prodId
      });
    }
  });
  return { success: true };
}

function updatePosStatus(posItemId, newStatus) {
  updateRow(DB_CONFIG.pos_items.name, 'pos_item_id', posItemId, { 'status': newStatus });
  return getModuleAData();
}

/* =========================================
   Module B: 產品與食材資料
   ========================================= */
function getModuleBData() {
  const products = getTableData(DB_CONFIG.products.name);
  const categories = getTableData(DB_CONFIG.product_categories.name);
  const ingredients = getTableData(DB_CONFIG.ingredients.name);
  const units = getTableData(DB_CONFIG.units.name); // 取得單位列表
  const semiProducts = ingredients.filter(i => String(i.is_semi_product).toLowerCase() === 'true');
  
  return { products, categories, semiProducts, ingredients, units }; 
}

// 單位管理功能
function createUnit(name) {
  const newId = getMaxId(DB_CONFIG.units.name, 'unit_id') + 1;
  insertRow(DB_CONFIG.units.name, { 'unit_id': newId, 'unit_name': name });
  return getModuleBData();
}

function updateUnit(id, name) {
  updateRow(DB_CONFIG.units.name, 'unit_id', id, { 'unit_name': name });
  return getModuleBData();
}

function createProductCategory(name) {
  const newId = getMaxId(DB_CONFIG.product_categories.name, 'category_id') + 1;
  insertRow(DB_CONFIG.product_categories.name, {
    'category_id': newId,
    'category_name': name
  });
  return getModuleBData(); 
}

function createNewProduct(name, categoryId) {
  const newId = getMaxId(DB_CONFIG.products.name, 'product_id') + 1;
  insertRow(DB_CONFIG.products.name, {
    'product_id': newId, 'product_name': name, 'category_id': categoryId
  });
  return getModuleBData();
}

function updateProduct(productId, name, categoryId) {
  updateRow(DB_CONFIG.products.name, 'product_id', productId, {
    'product_name': name, 'category_id': categoryId
  });
  return getModuleBData();
}

function createNewIngredient(name, source, isSemi) {
  const newId = getMaxId(DB_CONFIG.ingredients.name, 'ingredient_id') + 1;
  insertRow(DB_CONFIG.ingredients.name, {
    'ingredient_id': newId, 'ingredient_name': name,
    'purchase_source': source, 'is_semi_product': isSemi, 'erp_inventory_product_code': ''
  });
  return { success: true, newId: newId };
}

function updateIngredientDetails(id, name, source, isSemi) {
  updateRow(DB_CONFIG.ingredients.name, 'ingredient_id', id, {
    'ingredient_name': name,
    'purchase_source': source,
    'is_semi_product': isSemi
  });
  return getModuleBData();
}

function getBomDetail(itemId, type) {
  const tableName = type === 'product' ? DB_CONFIG.product_bom.name : DB_CONFIG.semi_product_bom.name;
  const idCol = type === 'product' ? 'product_id' : 'semi_product_id';
  const bomIdCol = type === 'product' ? 'product_bom_id' : 'semi_product_bom_id';
  
  const allBom = getTableData(tableName);
  const ingredients = getTableData(DB_CONFIG.ingredients.name);
  const units = getTableData(DB_CONFIG.units.name);
  
  const bomRows = allBom.filter(b => String(b[idCol]) === String(itemId));
  const enrichedBom = bomRows.map(b => {
    const ing = ingredients.find(i => String(i.ingredient_id) === String(b.ingredient_id));
    const u = units.find(unit => String(unit.unit_id) === String(b.unit_id));
    return {
      ...b,
      bom_id: b[bomIdCol],  
      ingredient_name: ing ? ing.ingredient_name : 'Unknown',
      unit_name: u ? u.unit_name : 'Unknown'
    };
  });
  return { bom: enrichedBom, ingredients, units };
}

function addBomItem(itemId, type, ingredientId, quantity, unitId) {
  const tableName = type === 'product' ? DB_CONFIG.product_bom.name : DB_CONFIG.semi_product_bom.name;
  const pkCol = type === 'product' ? 'product_bom_id' : 'semi_product_bom_id';
  const fkCol = type === 'product' ? 'product_id' : 'semi_product_id';
  
  const newId = getMaxId(tableName, pkCol) + 1;
  let row = {};
  row[pkCol] = newId; row[fkCol] = itemId; row['ingredient_id'] = ingredientId;
  row['quantity'] = quantity; row['unit_id'] = unitId;
  insertRow(tableName, row);
  return getBomDetail(itemId, type);
}

function removeBomItem(bomId, itemId, type) {
  const tableName = type === 'product' ? DB_CONFIG.product_bom.name : DB_CONFIG.semi_product_bom.name;
  const pkCol = type === 'product' ? 'product_bom_id' : 'semi_product_bom_id';
  deleteRowById(tableName, pkCol, bomId);
  return getBomDetail(itemId, type);
}

/* =========================================
   Module C: ERP 庫存對應
   ========================================= */
function getModuleCData() {
  const ingredients = getTableData(DB_CONFIG.ingredients.name);
  const units = getTableData(DB_CONFIG.units.name);
  return { ingredients: ingredients, units: units };
}

function searchErpInventory(query) {
  const erpData = getTableData(DB_CONFIG.erp_inventory.name);
  const units = getTableData(DB_CONFIG.units.name);
  const conversions = getTableData(DB_CONFIG.unit_conversions.name);

  if (!query) return [];
  const lowerQ = query.toLowerCase();
  
  return erpData.filter(e => 
    (e.erp_inventory_name && String(e.erp_inventory_name).toLowerCase().includes(lowerQ)) || 
    (e.product_code && String(e.product_code).toLowerCase().includes(lowerQ))
  ).slice(0, 20).map(e => {
    const u = units.find(unit => String(unit.unit_id) === String(e.inventory_unit_id));
    const existConv = conversions.find(c => String(c.erp_inventory_id) === String(e.erp_inventory_id));
    return { 
      ...e, 
      unit_name: u ? u.unit_name : 'Unknown',
      existing_conversion: existConv || null 
    };
  });
}

function linkIngredientComplex(form) {
  updateRow(DB_CONFIG.ingredients.name, 'ingredient_id', form.ingredientId, {
    'erp_inventory_product_code': form.erpProductCode
  });
  
  const erpData = getTableData(DB_CONFIG.erp_inventory.name).find(e => e.product_code == form.erpProductCode);
  const erpInvId = erpData ? erpData.erp_inventory_id : 0;
  
  const conversions = getTableData(DB_CONFIG.unit_conversions.name);
  const existConv = conversions.find(c => String(c.erp_inventory_id) === String(erpInvId));
  
  if (existConv) {
     updateRow(DB_CONFIG.unit_conversions.name, 'erp_inventory_id', erpInvId, {
        'warehouse_out_unit_id': form.whOutUnit,
        'warehouse_out_quantity': form.whOutQty,
        'warehouse_out_base_unit_id': form.erpInvUnitId,
        'warehouse_in_unit_id': form.whInUnit,
        'warehouse_in_quantity': form.whInQty,
        'warehouse_in_base_unit_id': form.whInBaseUnit
     });
  } else {
     const newId = getMaxId(DB_CONFIG.unit_conversions.name, 'id') + 1;
     insertRow(DB_CONFIG.unit_conversions.name, {
        'id': newId, 'erp_inventory_id': erpInvId,
        'warehouse_out_unit_id': form.whOutUnit,
        'warehouse_out_quantity': form.whOutQty,
        'warehouse_out_base_unit_id': form.erpInvUnitId,
        'warehouse_in_unit_id': form.whInUnit,
        'warehouse_in_quantity': form.whInQty,
        'warehouse_in_base_unit_id': form.whInBaseUnit
     });
  }
  return { success: true };
}


/* =========================================
   Module D: 門市對應
   ========================================= */
function getModuleDData() {
  try {
    var sheet = getStoreSheet_();
    ensureStoreSheetSchema_(sheet);

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol === 0) return [];

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim(); });

    var items = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        var key = headers[c];
        if (!key) continue;
        obj[key] = row[c];
      }

      // 前端依賴 id
      obj.id = String(obj.id || '').trim();
      if (!obj.id) {
        obj.id = Utilities.getUuid();
      }

      // 一些預設
      if (!obj.store_status) obj.store_status = 'active';
      if (!obj.country) obj.country = '台灣';

      items.push(obj);
    }

    return items;
  } catch (e) {
    Logger.log('Exception in getModuleDData: ' + e);
    return [];
  }
}

function updateStoreDetails(form) {
  try {
    var sheet = getStoreSheet_();
    ensureStoreSheetSchema_(sheet);

    form = form || {};
    var payload = {
      id: form.id,
      erp_customer_name: form.erp_customer_name,
      pos_store_name: form.pos_store_name,
      address_zhtw: form.address_zhtw,
      address_en: form.address_en,
      country: form.country,
      city: form.city,
      district: form.district,
      latitude: form.latitude,
      longitude: form.longitude,
      store_status: form.store_status,
      store_type: form.store_type
    };

    var result = upsertStoreRow_(sheet, payload);
    Logger.log('Store upsert: ' + JSON.stringify(result));
    return getModuleDData();
  } catch (e) {
    Logger.log('Exception in updateStoreDetails: ' + e);
    throw e;
  }
}

function deleteStore(id) {
  var sheet = getStoreSheet_();
  ensureStoreSheetSchema_(sheet);
  return deleteStoreRowById_(sheet, id);
}

function getStoreHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
}

function getHeaderIndexMap_(headers) {
  var map = {};
  headers.forEach(function (h, idx) {
    if (h) map[h] = idx;
  });
  return map;
}

function normalizeStoreRow_(obj) {
  if (!obj) obj = {};
  if (obj.store_status === undefined || obj.store_status === null || obj.store_status === '') obj.store_status = 'active';
  if (obj.country === undefined || obj.country === null || obj.country === '') obj.country = '台灣';
  return obj;
}

function upsertStoreRow_(sheet, obj) {
  obj = normalizeStoreRow_(obj);
  var headers = getStoreHeaders_(sheet);
  var idx = getHeaderIndexMap_(headers);
  var idCol = idx.id;
  if (idCol === undefined) throw new Error('stores sheet 缺少 id 欄位');

  var id = String(obj.id || '').trim();
  if (!id) {
    id = Utilities.getUuid();
    obj.id = id;
  }

  var lastRow = sheet.getLastRow();
  var targetRow = -1;
  if (lastRow >= 2) {
    var idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0] || '').trim() === id) {
        targetRow = i + 2;
        break;
      }
    }
  }

  // 僅更新既有欄位；忽略未知欄位
  function setCell(rowNum, key, value) {
    var c = idx[key];
    if (c === undefined) return;
    sheet.getRange(rowNum, c + 1).setValue(value === undefined ? '' : value);
  }

  if (targetRow === -1) {
    // 新增
    var newRow = headers.map(function (h) {
      return obj[h] === undefined ? '' : obj[h];
    });
    sheet.appendRow(newRow);
    return { ok: true, op: 'insert', id: id };
  }

  // 更新
  Object.keys(obj).forEach(function (k) {
    // 只有明確提供的欄位才覆寫；避免前端沒送的欄位被清空
    if (obj[k] === undefined) return;
    setCell(targetRow, k, obj[k]);
  });
  return { ok: true, op: 'update', id: id };
}

function deleteStoreRowById_(sheet, id) {
  var headers = getStoreHeaders_(sheet);
  var idx = getHeaderIndexMap_(headers);
  var idCol = idx.id;
  if (idCol === undefined) throw new Error('stores sheet 缺少 id 欄位');

  var targetId = String(id || '').trim();
  if (!targetId) return { ok: false, error: 'missing id' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, deleted: 0 };

  var idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0] || '').trim() === targetId) {
      sheet.deleteRow(i + 2);
      return { ok: true, deleted: 1, id: targetId };
    }
  }
  return { ok: true, deleted: 0, id: targetId };
}
