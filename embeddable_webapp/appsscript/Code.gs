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
function fetchRow_(table, column, value, schema, options) {
  const params = { table: table, col: column, val: value };
  if (schema) { params.schema = schema; }
  if (options && options.include_deleted) { params.include_deleted = "true"; }
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

