function doGet() {
  var props = PropertiesService.getScriptProperties();
  var t = HtmlService.createTemplateFromFile('Index');

  t.RUNTIME_CONFIG = {
    parentOrigin: props.getProperty('PARENT_ORIGIN'),
    tokenTransport: props.getProperty('TOKEN_TRANSPORT') || 'messagePort',
  };

  return t
    .evaluate()
    // 注意：Apps Script Web App 實際 iframe origin 通常會是 script.googleusercontent.com
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* 
-- user authentication
 */

function verifyTokenByProfileApi_(accessToken) {
  var url = 'https://tomato.yujing.me/api/profile';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      // 注意：依需求使用小寫 bearer
      Authorization: 'bearer ' + String(accessToken || '').trim(),
    },
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('Profile API non-200: ' + code + ' body=' + res.getContentText());
    return null;
  }

  var text = res.getContentText();
  var json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    Logger.log('Profile API invalid JSON: ' + e);
    return null;
  }

  if (!json || json.code !== 0 || !json.result) {
    Logger.log('Profile API unexpected payload: ' + text);
    return null;
  }

  // 回傳 result 供後續檢查 perm/username
  Logger.log( JSON.stringify(json.result));
  return json.result;
}

function hasCommodityPerm_(perm) {
  if (!perm || !Array.isArray(perm)) return false;

  for (var i = 0; i < perm.length; i++) {
    var p = perm[i];
    if (p === 'commodity') return true;
    if (p && typeof p === 'object' && String(p.key || '') === 'commodity') return true;
  }
  return false;
}

function checkCommodityPermission(accessToken) {
  var profile = verifyTokenByProfileApi_(accessToken);
  if (!profile) {
    return { allowed: false };
  }

  // 常見欄位：perm
  var allowed = hasCommodityPerm_(profile.perm);
  return { allowed: allowed };
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

function callSupabaseEdgeJson_(method, params, payload) {
  /* 
  唯一能和資料庫互動的工具
  */
  var baseUrl = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  var syncKey = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');

  if (!baseUrl || !syncKey) {
    throw new Error('Missing SUPABASE_URL or SYNC_KEY in Script Properties');
  }

  var url = baseUrl;
  if (params) {
    var queryString = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); })
      .join('&');
    if (queryString) url += '?' + queryString;
  }

  var options = {
    method: method,
    contentType: 'application/json',
    headers: {
      'x-sync-key': syncKey,
      'Authorization': 'Bearer ' + syncKey
    },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();

  var json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { raw: text };
  }

  if (code < 200 || code >= 300) {
    throw new Error('Edge Function error ' + code + ': ' + text);
  }

  return json;
}

/**
 * 通用 Fetch (查詢)
 * @param {string} table 表格名稱
 * @param {Object} queryParams 查詢參數 (例如 { limit: 10, col: "name", val: "apple" })
 */
function fetchRows_(table, queryParams) {
  const params = { table: table, ...queryParams };
  return callSupabaseEdgeJson_("get", params, null);
}

/**
 * 通用 Fetch Single Row (單筆查詢)
 * @param {string} table 表格名稱
 * @param {string} column 查詢欄位名稱
 * @param {*} value 查詢值
 * @param {string} [schema] 可選的 schema (例如 'tb_mgmt')
 * @return {Object} Edge Function 回應 { ok: true, item: {...} } 或 { ok: true, item: null }
 */
function fetchRow_(table, column, value, schema) {
  const params = { table: table, col: column, val: value };
  if (schema) { params.schema = schema; }
  return callSupabaseEdgeJson_("get", params, null);
}

/**
 * 通用 Upsert (新增或更新)
 * @param {string} table 表格名稱
 * @param {Object} row 資料列物件
 * @param {string[]} conflictColumns 衝突判斷欄位 (例如 ['id'] 或 ['name'])
 * @param {string} schema 可選的 schema (例如 'tb_mgmt')
 */
function upsertRow_(table, row, conflictColumns, schema) {
  const payload = {
    op: "upsert",
    event_id: Utilities.getUuid(),
    table: table,
    row: row,
    conflict_columns: conflictColumns
  };
  if (schema) {
    payload.schema = schema;
  }
  return callSupabaseEdgeJson_("post", null, payload);
}

/**
 * 通用 Delete (刪除)
 * @param {string} table 表格名稱
 * @param {Object} filter 刪除條件 (例如 { id: 123 } 或 { name: "apple" })
 * @param {string} schema 可選的 schema (例如 'tb_mgmt')
 */
function deleteRow_(table, filter, schema) {
  const payload = {
    op: "delete",
    event_id: Utilities.getUuid(),
    table: table,
    filter: filter
  };
  if (schema) {
    payload.schema = schema;
  }
  return callSupabaseEdgeJson_("post", null, payload);
}

/* =========================================
   Status 缓存（避免重复查询）
   ========================================= */
var CACHED_STATUS_IDS = null;

/**
 * 获取 status IDs（缓存机制）
 * @return {Object} { active: number, inactive: number }
 */
function getStatusIds_() {
  if (CACHED_STATUS_IDS) {
    return CACHED_STATUS_IDS;
  }

  var result = fetchRows_("status", { limit: 10, schema: "tb_mgmt" });
  if (!result || !result.ok || !result.items) {
    throw new Error("Failed to fetch status");
  }

  var activeStatus = result.items.find(function(s) { return s.status === "active"; });
  var inactiveStatus = result.items.find(function(s) { return s.status === "inactive"; });

  if (!activeStatus || !inactiveStatus) {
    throw new Error("Status 'active' or 'inactive' not found");
  }

  CACHED_STATUS_IDS = {
    active: activeStatus.id,
    inactive: inactiveStatus.id
  };

  Logger.log("Status IDs cached: " + JSON.stringify(CACHED_STATUS_IDS));
  return CACHED_STATUS_IDS;
}

/**
 * 清除 status 缓存（仅用于测试或强制刷新）
 */
function clearStatusCache_() {
  CACHED_STATUS_IDS = null;
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


/* =========================================
   Module E: 庫存細節 (Supabase inventory_details + Sheet erp_inventory)
   ========================================= */

function getModuleEData() {
  // 1) Google Sheet 的 erp_inventory（所有库存品项）
  var erpItems = getTableData(DB_CONFIG.erp_inventory.name) || [];
  var units = getTableData(DB_CONFIG.units.name) || [];

  // 建立 unit_id -> unit_name 映射
  var unitMap = {};
  units.forEach(function (u) {
    unitMap[String(u.unit_id)] = u.unit_name;
  });

  // 2) Supabase inventory_details（使用 fetchRows_ helper）
  var detailsResp = fetchRows_("inventory_details", {
    limit: 200,
    schema: "tb_mgmt",
    include_deleted: "false"  // 只获取 active 记录
  });

  if (!detailsResp || !detailsResp.ok) {
    Logger.log("Warning: Failed to fetch inventory_details from Supabase");
    // 继续执行，但 details 为空数组
  }

  var details = (detailsResp && detailsResp.items) ? detailsResp.items : [];

  // 3) 建立 erp_inventory_id -> inventory_details 映射
  var detailMap = {};
  details.forEach(function (d) {
    var erpInvId = String(d.erp_inventory_id || '');
    if (erpInvId) {
      detailMap[erpInvId] = d;
    }
  });

  // 4) 合并数据（每个 erp_inventory 品项一行）
  var merged = erpItems.map(function (e) {
    var erpInvId = String(e.erp_inventory_id || '');
    var productCode = String(e.product_code || '').trim();
    var erpInvName = e.erp_inventory_name || '';
    var unitName = unitMap[String(e.inventory_unit_id)] || '';

    var det = erpInvId ? (detailMap[erpInvId] || null) : null;

    // 基础信息（来自 erp_inventory）
    var base = {
      product_code: productCode,
      erp_inventory_name: erpInvName,
      unit_name: unitName,
      _has_detail: !!det
    };

    if (!det) {
      // 没有详细数据
      return base;
    }

    // 有详细数据：合并 inventory_details 的业务字段
    // 过滤掉不需要的字段：id, public_id, erp_inventory_id, created_at, status_id
    return {
      product_code: productCode,
      erp_inventory_name: erpInvName,
      unit_name: unitName,
      category: det.category,
      rank: det.rank,
      shelf_life_days: det.shelf_life_days,
      shelf_life_category: det.shelf_life_category,
      sales_grade: det.sales_grade,
      lead_time_days: det.lead_time_days,
      delivery: det.delivery,
      max_purchase_param: det.max_purchase_param,
      safety_stock_param: det.safety_stock_param,
      inventory_turnover_days: det.inventory_turnover_days,
      updated_at: det.updated_at,  // 保留更新时间供前端参考
      _has_detail: true
    };
  });

  return merged;
}

function upsertInventoryDetail(form) {
  form = form || {};

  // 1) 前端传递 product_code，需要查询 erp_inventory_id
  var productCode = String(form.product_code || '').trim();
  if (!productCode) {
    throw new Error('Missing product_code');
  }

  // 2) 查询 erp_inventory 获取 erp_inventory_id（使用 fetchRow_ helper）
  var erpResp = fetchRow_("erp_inventory", "product_code", productCode, "tb_mgmt");
  if (!erpResp || !erpResp.ok || !erpResp.item) {
    throw new Error("ERP inventory not found for product_code: " + productCode);
  }

  var erpInventoryId = erpResp.item.id;

  // 3) 获取 active status ID（使用缓存）
  var statusIds = getStatusIds_();

  // 4) 准备 inventory_details 数据
  // 只包含业务字段，不包含关联表字段（item_name, unit 等）
  var row = {
    erp_inventory_id: erpInventoryId,
    category: form.category || null,
    rank: form.rank || null,
    shelf_life_days: form.shelf_life_days || null,
    shelf_life_category: form.shelf_life_category || null,
    sales_grade: form.sales_grade || null,
    lead_time_days: form.lead_time_days || null,
    delivery: form.delivery || null,
    max_purchase_param: form.max_purchase_param || null,
    safety_stock_param: form.safety_stock_param || null,
    inventory_turnover_days: form.inventory_turnover_days || null,
    status_id: statusIds.active,  // 确保是 active 状态
    updated_at: new Date().toISOString()  // 自动更新时间
  };

  // 5) 使用 upsertRow_ helper（基于 erp_inventory_id 冲突）
  var result = upsertRow_(
    "inventory_details",
    row,
    ["erp_inventory_id"],  // conflict column
    "tb_mgmt"  // schema
  );

  if (!result || !result.ok) {
    throw new Error("Failed to upsert inventory_detail");
  }

  // 6) 返回更新后的完整数据
  return getModuleEData();
}

function testGetModuleEData() {
  var data = getModuleEData();
  Logger.log("Total items: " + data.length);
  Logger.log("Sample: " + JSON.stringify(data[0]));
  return data;
}

function testUpsertInventoryDetail() {
  // 测试：更新某个品项的详细信息
  var form = {
    product_code: "A00002",  // 前端传递 product_code
    category: "长效*热销",
    rank: 1,
    shelf_life_days: 365,
    shelf_life_category: "长效*",
    sales_grade: "热销",
    lead_time_days: 7,
    delivery: "W2、5；W5会较多",
    max_purchase_param: 7,
    safety_stock_param: 10,
    inventory_turnover_days: 17.5
  };

  return upsertInventoryDetail(form);
}

function testDeleteInventoryDetail() {
  // 使用 deleteRow_ helper 进行软删除
  var productCode = "A00012";

  // 1) 先查询 erp_inventory_id
  var erpResp = fetchRow_("erp_inventory", "product_code", productCode, "tb_mgmt");
  if (!erpResp || !erpResp.ok || !erpResp.item) {
    throw new Error("ERP inventory not found");
  }

  var erpInventoryId = erpResp.item.id;

  // 2) 使用 deleteRow_ 进行软删除（更新 status_id = inactive）
  var result = deleteRow_(
    "inventory_details",
    { erp_inventory_id: erpInventoryId },
    "tb_mgmt"
  );

  Logger.log("Delete result: " + JSON.stringify(result));
  return result;
}

function testFetchInventoryDetail() {
  // 使用 fetchRow_ helper 查询单条记录
  var productCode = "A00002";

  // 1) 先查询 erp_inventory_id
  var erpResp = fetchRow_("erp_inventory", "product_code", productCode, "tb_mgmt");
  if (!erpResp || !erpResp.ok || !erpResp.item) {
    return { error: "ERP inventory not found" };
  }

  var erpInventoryId = erpResp.item.id;

  // 2) 查询 inventory_details
  var detailResp = fetchRow_("inventory_details", "erp_inventory_id", erpInventoryId, "tb_mgmt");

  Logger.log("Detail: " + JSON.stringify(detailResp));
  return detailResp;
}
