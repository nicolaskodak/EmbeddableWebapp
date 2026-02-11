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
   Module C: ERP 庫存對應 (Supabase)
   ========================================= */

function getModuleCData() {
  try {
    // 1) 查询 ingredients 表
    var ingredientsResp = fetchRows_("ingredients", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var ingredients = (ingredientsResp && ingredientsResp.items) ? ingredientsResp.items : [];

    // 2) 查询 units 表
    var unitsResp = fetchRows_("units", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var units = (unitsResp && unitsResp.items) ? unitsResp.items : [];

    // 3) 字段名转换（保持前端兼容）
    var mappedIngredients = ingredients.map(function(ing) {
      return {
        ingredient_id: ing.id,  // id → ingredient_id
        ingredient_name: ing.ingredient_name,
        is_semi_product: ing.is_semi_product,
        purchase_source: ing.purchase_source,
        erp_inventory_id: ing.erp_inventory_id,  // 保持 FK ID
        updated_at: ing.updated_at
      };
    });

    var mappedUnits = units.map(function(u) {
      return {
        unit_id: u.id,  // id → unit_id
        unit_name: u.unit_name,
        updated_at: u.updated_at
      };
    });

    return {
      ingredients: mappedIngredients,
      units: mappedUnits
    };
  } catch (e) {
    Logger.log('Exception in getModuleCData: ' + e);
    return { ingredients: [], units: [] };
  }
}

function searchErpInventory(query) {
  try {
    if (!query) return [];

    // 1) 查询 erp_inventory 表
    var erpResp = fetchRows_("erp_inventory", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var erpData = (erpResp && erpResp.items) ? erpResp.items : [];

    // 2) 查询 units 表
    var unitsResp = fetchRows_("units", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var units = (unitsResp && unitsResp.items) ? unitsResp.items : [];

    // 3) 查询 unit_conversions 表
    var conversionsResp = fetchRows_("unit_conversions", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var conversions = (conversionsResp && conversionsResp.items) ? conversionsResp.items : [];

    // 4) 在内存中过滤
    var lowerQ = query.toLowerCase();
    var filtered = erpData.filter(function(e) {
      return (e.erp_inventory_name && String(e.erp_inventory_name).toLowerCase().indexOf(lowerQ) >= 0) ||
             (e.product_code && String(e.product_code).toLowerCase().indexOf(lowerQ) >= 0);
    }).slice(0, 20);

    // 5) 关联数据并转换字段名
    var result = filtered.map(function(e) {
      var u = units.find(function(unit) {
        return String(unit.id) === String(e.inventory_unit_id);
      });

      var existConv = conversions.find(function(c) {
        return String(c.erp_inventory_id) === String(e.id);
      });

      // 字段名转换（保持前端兼容）
      return {
        erp_inventory_id: e.id,  // id → erp_inventory_id
        product_code: e.product_code,
        erp_inventory_name: e.erp_inventory_name,
        inventory_unit_id: e.inventory_unit_id,
        unit_name: u ? u.unit_name : 'Unknown',
        existing_conversion: existConv ? {
          id: existConv.id,
          erp_inventory_id: existConv.erp_inventory_id,
          warehouse_in_unit_id: existConv.warehouse_in_unit_id,
          warehouse_in_quantity: existConv.warehouse_in_quantity,
          warehouse_in_base_unit_id: existConv.warehouse_in_base_unit_id,
          warehouse_out_unit_id: existConv.warehouse_out_unit_id,
          warehouse_out_quantity: existConv.warehouse_out_quantity,
          warehouse_out_base_unit_id: existConv.warehouse_out_base_unit_id
        } : null,
        updated_at: e.updated_at
      };
    });

    return result;
  } catch (e) {
    Logger.log('Exception in searchErpInventory: ' + e);
    return [];
  }
}

function linkIngredientComplex(form) {
  try {
    form = form || {};

    // 1) 查询 erp_inventory 获取 ID（前端传递 product_code）
    var erpResp = fetchRow_("erp_inventory", "product_code", form.erpProductCode, "tb_mgmt");
    if (!erpResp || !erpResp.ok || !erpResp.item) {
      throw new Error("ERP inventory not found for product_code: " + form.erpProductCode);
    }

    var erpInventoryId = erpResp.item.id;

    // 2) 获取 status IDs
    var statusIds = getStatusIds_();

    // 3) 更新 ingredient 的 erp_inventory_id
    // NOTE: Must fetch existing row first because Supabase .upsert() treats
    // missing fields as NULL, which violates NOT NULL constraints.
    // We merge the new values with existing data before upserting.
    var existingIngredientResp = fetchRow_("ingredients", "id", form.ingredientId, "tb_mgmt");

    if (!existingIngredientResp || !existingIngredientResp.ok || !existingIngredientResp.item) {
      throw new Error("Ingredient not found for id: " + form.ingredientId);
    }

    var existingIngredient = existingIngredientResp.item;

    // Merge: Keep all existing fields, update only erp_inventory_id
    var ingredientRow = {
      id: existingIngredient.id,
      ingredient_name: existingIngredient.ingredient_name,  // Preserve existing
      is_semi_product: existingIngredient.is_semi_product,  // Preserve existing
      purchase_source: existingIngredient.purchase_source,  // Preserve existing
      erp_inventory_id: erpInventoryId,  // UPDATE: New value
      status_id: existingIngredient.status_id,  // Preserve existing
      updated_at: new Date().toISOString()  // UPDATE: New timestamp
    };

    var updateIngredientResult = upsertRow_(
      "ingredients",
      ingredientRow,
      ["id"],
      "tb_mgmt"
    );

    if (!updateIngredientResult || !updateIngredientResult.ok) {
      throw new Error("Failed to update ingredient");
    }

    // 4) 检查是否已存在 unit_conversion
    var existingConvResp = fetchRow_("unit_conversions", "erp_inventory_id", erpInventoryId, "tb_mgmt");

    var conversionRow = {
      erp_inventory_id: erpInventoryId,
      warehouse_out_unit_id: form.whOutUnit || null,
      warehouse_out_quantity: form.whOutQty || null,
      warehouse_out_base_unit_id: form.erpInvUnitId || null,
      warehouse_in_unit_id: form.whInUnit || null,
      warehouse_in_quantity: form.whInQty || null,
      warehouse_in_base_unit_id: form.whInBaseUnit || null,
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    };

    // 5) Upsert unit_conversion（基于 erp_inventory_id UNIQUE 约束）
    var conversionResult = upsertRow_(
      "unit_conversions",
      conversionRow,
      ["erp_inventory_id"],
      "tb_mgmt"
    );

    if (!conversionResult || !conversionResult.ok) {
      throw new Error("Failed to upsert unit_conversion");
    }

    return { success: true };
  } catch (e) {
    Logger.log('Exception in linkIngredientComplex: ' + e);
    throw e;
  }
}

// ==========================================
// Test Functions: Module C (ERP Inventory Mapping)
// ==========================================

function testGetModuleCData() {
  var data = getModuleCData();
  Logger.log("Ingredients count: " + data.ingredients.length);
  Logger.log("Units count: " + data.units.length);

  if (data.ingredients.length > 0) {
    Logger.log("Sample ingredient: " + JSON.stringify(data.ingredients[0]));
    Logger.log("Ingredient fields: " + Object.keys(data.ingredients[0]).join(", "));

    // 验证字段名转换
    var sample = data.ingredients[0];
    if (sample.ingredient_id !== undefined) {
      Logger.log("✅ Field mapped correctly: id → ingredient_id");
    } else {
      Logger.log("❌ Field mapping failed: ingredient_id not found");
    }
  }

  if (data.units.length > 0) {
    Logger.log("Sample unit: " + JSON.stringify(data.units[0]));

    var sampleUnit = data.units[0];
    if (sampleUnit.unit_id !== undefined) {
      Logger.log("✅ Field mapped correctly: id → unit_id");
    } else {
      Logger.log("❌ Field mapping failed: unit_id not found");
    }
  }

  return data;
}

function testSearchErpInventory() {
  // 测试搜索功能
  var query = "豬排";  // 搜索关键字

  Logger.log("Searching for: " + query);
  var results = searchErpInventory(query);
  Logger.log("Search results count: " + results.length);

  if (results.length > 0) {
    Logger.log("Sample result: " + JSON.stringify(results[0]));
    Logger.log("Result fields: " + Object.keys(results[0]).join(", "));

    var sample = results[0];

    // 验证字段
    if (sample.erp_inventory_id !== undefined) {
      Logger.log("✅ Field present: erp_inventory_id");
    }

    if (sample.product_code !== undefined) {
      Logger.log("✅ Field present: product_code");
    }

    if (sample.unit_name !== undefined) {
      Logger.log("✅ Unit name mapped: " + sample.unit_name);
    }

    if (sample.existing_conversion !== undefined) {
      Logger.log("✅ Conversion data present: " + (sample.existing_conversion ? "Yes" : "No"));
      if (sample.existing_conversion) {
        Logger.log("  Conversion details: " + JSON.stringify(sample.existing_conversion));
      }
    }
  } else {
    Logger.log("⚠️ No results found. Try a different search query.");
  }

  return results;
}

function testLinkIngredientComplex() {
  // 测试关联 ingredient 到 erp_inventory
  // 需要先准备测试数据

  // 1) 获取第一个 ingredient
  var moduleCData = getModuleCData();
  if (moduleCData.ingredients.length === 0) {
    Logger.log("No ingredients found. Cannot test.");
    return null;
  }

  var testIngredient = moduleCData.ingredients[0];
  Logger.log("Testing with ingredient: " + JSON.stringify(testIngredient));

  // 2) 搜索一个 erp_inventory
  var searchResults = searchErpInventory("豬");
  if (searchResults.length === 0) {
    Logger.log("No ERP inventory found. Cannot test.");
    return null;
  }

  var testErp = searchResults[0];
  Logger.log("Testing with ERP inventory: " + JSON.stringify(testErp));

  // 3) 获取 units 用于测试
  if (moduleCData.units.length === 0) {
    Logger.log("No units found. Cannot test.");
    return null;
  }

  var testUnit = moduleCData.units[0];
  Logger.log("Testing with unit: " + JSON.stringify(testUnit));

  // 4) 构造测试表单
  var form = {
    ingredientId: testIngredient.ingredient_id,
    erpProductCode: testErp.product_code,
    whOutUnit: testUnit.unit_id,
    whOutQty: 100,
    erpInvUnitId: testErp.inventory_unit_id,
    whInUnit: testUnit.unit_id,
    whInQty: 1,
    whInBaseUnit: testErp.inventory_unit_id
  };

  Logger.log("Linking with form: " + JSON.stringify(form));

  // 5) 执行关联
  var result = linkIngredientComplex(form);
  Logger.log("Link result: " + JSON.stringify(result));

  if (result && result.success) {
    Logger.log("✅ Link successful");

    // 验证关联结果
    var updatedIngredient = fetchRow_("ingredients", "id", testIngredient.ingredient_id, "tb_mgmt");
    if (updatedIngredient && updatedIngredient.ok && updatedIngredient.item) {
      Logger.log("  Updated ingredient erp_inventory_id: " + updatedIngredient.item.erp_inventory_id);

      // 验证 unit_conversion
      var conversionResp = fetchRow_("unit_conversions", "erp_inventory_id", updatedIngredient.item.erp_inventory_id, "tb_mgmt");
      if (conversionResp && conversionResp.ok && conversionResp.item) {
        Logger.log("✅ Unit conversion created/updated:");
        Logger.log("  " + JSON.stringify(conversionResp.item));
      } else {
        Logger.log("❌ Unit conversion not found");
      }
    }
  } else {
    Logger.log("❌ Link failed");
  }

  return result;
}

function testModuleCFieldMapping() {
  // 测试字段映射是否正确
  Logger.log("=== Testing Module C Field Mapping ===");

  // 1. 直接查询数据库（原始数据）
  var rawIngredientsResp = fetchRows_("ingredients", {
    limit: 5,
    schema: "tb_mgmt",
    include_deleted: "false"
  });

  if (!rawIngredientsResp || !rawIngredientsResp.ok || rawIngredientsResp.items.length === 0) {
    Logger.log("No ingredients in database");
    return;
  }

  var rawIngredient = rawIngredientsResp.items[0];
  Logger.log("\n1. Raw ingredient data (from database):");
  Logger.log("  id: " + rawIngredient.id + " (type: " + typeof rawIngredient.id + ")");
  Logger.log("  ingredient_name: " + rawIngredient.ingredient_name);

  // 2. 通过 getModuleCData 获取映射后的数据
  var moduleCData = getModuleCData();
  var mappedIngredient = moduleCData.ingredients.find(function(ing) {
    return ing.ingredient_id === rawIngredient.id;
  });

  if (mappedIngredient) {
    Logger.log("\n2. Mapped ingredient data (after getModuleCData):");
    Logger.log("  ingredient_id: " + mappedIngredient.ingredient_id + " (type: " + typeof mappedIngredient.ingredient_id + ")");
    Logger.log("  ingredient_name: " + mappedIngredient.ingredient_name);

    // 3. 验证映射
    if (mappedIngredient.ingredient_id === rawIngredient.id) {
      Logger.log("✅ id → ingredient_id mapping correct");
    } else {
      Logger.log("❌ id → ingredient_id mapping incorrect");
    }
  }

  // 测试 units 映射
  var rawUnitsResp = fetchRows_("units", {
    limit: 5,
    schema: "tb_mgmt",
    include_deleted: "false"
  });

  if (rawUnitsResp && rawUnitsResp.ok && rawUnitsResp.items.length > 0) {
    var rawUnit = rawUnitsResp.items[0];
    Logger.log("\n3. Raw unit data (from database):");
    Logger.log("  id: " + rawUnit.id);

    var mappedUnit = moduleCData.units.find(function(u) {
      return u.unit_id === rawUnit.id;
    });

    if (mappedUnit && mappedUnit.unit_id === rawUnit.id) {
      Logger.log("✅ id → unit_id mapping correct");
    } else {
      Logger.log("❌ id → unit_id mapping incorrect");
    }
  }
}


/* =========================================
   Module D: 門市對應 (Supabase stores)
   ========================================= */

function getModuleDData() {
  try {
    // 1) 查询 stores 表
    var storesResp = fetchRows_("stores", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    if (!storesResp || !storesResp.ok) {
      Logger.log("Warning: Failed to fetch stores from Supabase");
      return [];
    }

    var stores = (storesResp && storesResp.items) ? storesResp.items : [];

    // 2) 查询 pos_stores 表（获取所有 POS 门店名称）
    var posStoresResp = fetchRows_("pos_stores", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var posStores = (posStoresResp && posStoresResp.items) ? posStoresResp.items : [];

    // 建立 id -> pos_store_name 映射
    var posStoreMap = {};
    posStores.forEach(function(ps) {
      posStoreMap[String(ps.id)] = ps.pos_store_name;
    });

    // 3) 查询 erp_customers 表（获取所有 ERP 客户名称）
    var erpCustomersResp = fetchRows_("erp_customers", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var erpCustomers = (erpCustomersResp && erpCustomersResp.items) ? erpCustomersResp.items : [];

    // 建立 id -> erp_customer_name 映射
    var erpCustomerMap = {};
    erpCustomers.forEach(function(ec) {
      erpCustomerMap[String(ec.id)] = ec.erp_customer_name;
    });

    // 4) 获取 status IDs 用于映射
    var statusIds = getStatusIds_();

    // 5) 关联数据并转换
    var result = stores.map(function(s) {
      // 将 status_id 转换为 store_status（保持前端接口不变）
      var storeStatus = 'active';
      if (s.status_id === statusIds.inactive) {
        storeStatus = 'inactive';
      }

      // 从映射中获取 TEXT 名称（stores 表存储的是 FK ID）
      var posStoreName = s.pos_store_name ? (posStoreMap[String(s.pos_store_name)] || null) : null;
      var erpCustomerName = erpCustomerMap[String(s.erp_customer_name)] || null;

      // 返回前端需要的格式
      return {
        id: s.id,
        erp_customer_name: erpCustomerName,  // TEXT（从 FK 转换而来）
        pos_store_name: posStoreName,  // TEXT（从 FK 转换而来）
        address_zh: s.address_zh,  // 修正字段名
        address_en: s.address_en,
        country: s.country || '台灣',
        city: s.city,
        district: s.district,
        latitude: s.latitude,
        longitude: s.longitude,
        store_status: storeStatus,
        store_type: s.store_type,
        updated_at: s.updated_at
      };
    });

    return result;
  } catch (e) {
    Logger.log('Exception in getModuleDData: ' + e);
    return [];
  }
}

function updateStoreDetails(form) {
  try {
    form = form || {};

    // 1) 获取 status IDs
    var statusIds = getStatusIds_();

    // 2) 将 store_status 转换为 status_id（保持前端接口不变）
    var statusId = statusIds.active; // 默认
    if (form.store_status === 'inactive') {
      statusId = statusIds.inactive;
    }

    // 3) 处理 pos_store_name (TEXT -> ID)
    // 前端传递 TEXT，需要转换为 FK ID
    var posStoreId = null;
    if (form.pos_store_name) {
      // 查询或创建 pos_store
      var posStoreResp = fetchRow_("pos_stores", "pos_store_name", form.pos_store_name, "tb_mgmt");

      if (posStoreResp && posStoreResp.ok && posStoreResp.item) {
        // 已存在，使用现有 ID
        posStoreId = posStoreResp.item.id;
      } else {
        // 不存在，创建新的 pos_store
        var newPosStore = upsertRow_(
          "pos_stores",
          {
            pos_store_name: form.pos_store_name,
            status_id: statusIds.active,
            updated_at: new Date().toISOString()
          },
          ["pos_store_name"],
          "tb_mgmt"
        );

        // 重新查询获取 ID
        posStoreResp = fetchRow_("pos_stores", "pos_store_name", form.pos_store_name, "tb_mgmt");
        if (posStoreResp && posStoreResp.ok && posStoreResp.item) {
          posStoreId = posStoreResp.item.id;
        } else {
          Logger.log("Warning: Failed to get pos_store ID after upsert");
        }
      }
    }

    // 4) 处理 erp_customer_name (TEXT -> ID)
    // 前端传递 TEXT，需要转换为 FK ID
    var erpCustomerId = null;
    if (form.erp_customer_name) {
      // 查询或创建 erp_customer
      var erpCustomerResp = fetchRow_("erp_customers", "erp_customer_name", form.erp_customer_name, "tb_mgmt");

      if (erpCustomerResp && erpCustomerResp.ok && erpCustomerResp.item) {
        // 已存在，使用现有 ID
        erpCustomerId = erpCustomerResp.item.id;
      } else {
        // 不存在，创建新的 erp_customer
        var newErpCustomer = upsertRow_(
          "erp_customers",
          {
            erp_customer_name: form.erp_customer_name,
            status_id: statusIds.active,
            updated_at: new Date().toISOString()
          },
          ["erp_customer_name"],
          "tb_mgmt"
        );

        // 重新查询获取 ID
        erpCustomerResp = fetchRow_("erp_customers", "erp_customer_name", form.erp_customer_name, "tb_mgmt");
        if (erpCustomerResp && erpCustomerResp.ok && erpCustomerResp.item) {
          erpCustomerId = erpCustomerResp.item.id;
        } else {
          throw new Error("Failed to get erp_customer ID after upsert");
        }
      }
    }

    if (!erpCustomerId) {
      throw new Error("erp_customer_name is required");
    }

    // 5) 准备 stores 表数据
    var row = {
      erp_customer_name: erpCustomerId,  // BIGINT FK (required)
      pos_store_name: posStoreId,  // BIGINT FK (可以为 null)
      address_zh: form.address_zh || null,  // 修正字段名
      address_en: form.address_en || null,
      country: form.country || '台灣',
      city: form.city || null,
      district: form.district || null,
      latitude: form.latitude || null,
      longitude: form.longitude || null,
      store_type: form.store_type || null,
      status_id: statusId,
      updated_at: new Date().toISOString()
    };

    // 6) 确定 conflict key
    // 如果有 id，基于 id 更新；否则基于 erp_customer_name（UNIQUE 约束）
    var conflictKey;
    if (form.id) {
      row.id = form.id;
      conflictKey = ["id"];
    } else {
      conflictKey = ["erp_customer_name"];
    }

    // 7) 使用 upsertRow_ helper
    var result = upsertRow_(
      "stores",
      row,
      conflictKey,
      "tb_mgmt"
    );

    if (!result || !result.ok) {
      throw new Error("Failed to upsert store");
    }

    Logger.log('Store upsert: ' + JSON.stringify(result));

    // 8) 返回更新后的数据
    return getModuleDData();
  } catch (e) {
    Logger.log('Exception in updateStoreDetails: ' + e);
    throw e;
  }
}

function deleteStore(id) {
  if (!id) {
    throw new Error("Missing store id");
  }

  // 使用 deleteRow_ 进行软删除（更新 status_id = inactive）
  var result = deleteRow_("stores", { id: id }, "tb_mgmt");

  if (!result || !result.ok) {
    throw new Error("Failed to delete store");
  }

  return { ok: true, deleted: 1, id: id };
}

// ==========================================
// Test Functions: Module D (Stores)
// ==========================================

function testGetModuleDData() {
  var stores = getModuleDData();
  Logger.log("Total stores: " + stores.length);

  if (stores.length > 0) {
    Logger.log("Sample store: " + JSON.stringify(stores[0]));
    Logger.log("Fields: " + Object.keys(stores[0]).join(", "));

    // 验证字段类型
    var sample = stores[0];
    Logger.log("erp_customer_name type: " + typeof sample.erp_customer_name + " (should be string)");
    Logger.log("pos_store_name type: " + typeof sample.pos_store_name + " (should be string or null)");
  }

  return stores;
}

function testCreateStore() {
  // 测试新增门店（会自动创建 erp_customer 和 pos_store）
  var form = {
    erp_customer_name: "测试客户 " + new Date().getTime(),
    pos_store_name: "测试 POS 门店 " + new Date().getTime(),
    address_zh: "台北市信义区信义路五段7号",
    address_en: "No.7, Sec. 5, Xinyi Rd., Xinyi Dist., Taipei City",
    country: "台灣",
    city: "台北市",
    district: "信义区",
    latitude: 25.033,
    longitude: 121.565,
    store_type: "direct",
    store_status: "active"
  };

  Logger.log("Creating store with form: " + JSON.stringify(form));
  var result = updateStoreDetails(form);
  Logger.log("Create result - total stores: " + result.length);

  // 查找刚创建的门店
  var newStore = result.find(function(s) {
    return s.erp_customer_name === form.erp_customer_name;
  });

  if (newStore) {
    Logger.log("✅ Store created successfully:");
    Logger.log("  ID: " + newStore.id);
    Logger.log("  ERP Customer: " + newStore.erp_customer_name);
    Logger.log("  POS Store: " + newStore.pos_store_name);
    Logger.log("  Status: " + newStore.store_status);
  } else {
    Logger.log("❌ Failed to find newly created store");
  }

  return result;
}

function testUpdateStore() {
  // 测试更新门店（基于 id）
  // 先获取第一个门店
  var stores = getModuleDData();

  if (stores.length === 0) {
    Logger.log("No stores found. Please create a store first using testCreateStore()");
    return null;
  }

  var targetStore = stores[0];
  Logger.log("Updating store ID: " + targetStore.id);
  Logger.log("Current data: " + JSON.stringify(targetStore));

  var form = {
    id: targetStore.id,
    erp_customer_name: targetStore.erp_customer_name,
    pos_store_name: targetStore.pos_store_name,
    address_zh: "更新后的地址：台北市大安区 " + new Date().getTime(),
    address_en: "Updated Address: Daan District, Taipei",
    country: "台灣",
    city: "台北市",
    district: "大安区",
    store_type: "franchise",  // 改变类型
    store_status: "active"
  };

  var result = updateStoreDetails(form);
  Logger.log("Update result - total stores: " + result.length);

  // 查找更新后的门店
  var updatedStore = result.find(function(s) {
    return s.id === targetStore.id;
  });

  if (updatedStore) {
    Logger.log("✅ Store updated successfully:");
    Logger.log("  Address changed: " + targetStore.address_zh + " → " + updatedStore.address_zh);
    Logger.log("  Type changed: " + targetStore.store_type + " → " + updatedStore.store_type);
  } else {
    Logger.log("❌ Failed to find updated store");
  }

  return result;
}

function testDeleteStore() {
  // 测试软删除门店
  var stores = getModuleDData();

  if (stores.length === 0) {
    Logger.log("No stores found. Please create a store first using testCreateStore()");
    return null;
  }

  // 找一个测试门店（名称包含"测试"的）
  var testStore = stores.find(function(s) {
    return s.erp_customer_name && s.erp_customer_name.indexOf("测试") >= 0;
  });

  if (!testStore) {
    Logger.log("No test store found. Using first store instead.");
    testStore = stores[0];
  }

  Logger.log("Deleting store ID: " + testStore.id);
  Logger.log("Store name: " + testStore.erp_customer_name);

  var deleteResult = deleteStore(testStore.id);
  Logger.log("Delete result: " + JSON.stringify(deleteResult));

  // 验证门店已被软删除（不再出现在列表中）
  var storesAfter = getModuleDData();
  var stillExists = storesAfter.find(function(s) {
    return s.id === testStore.id;
  });

  if (!stillExists) {
    Logger.log("✅ Store soft-deleted successfully - no longer appears in active list");
    Logger.log("  Stores before: " + stores.length);
    Logger.log("  Stores after: " + storesAfter.length);
  } else {
    Logger.log("❌ Store still appears in active list");
  }

  // 验证记录仍存在于数据库（使用 include_deleted）
  var allStoresResp = fetchRows_("stores", {
    limit: 200,
    schema: "tb_mgmt",
    include_deleted: "true"
  });

  if (allStoresResp && allStoresResp.ok) {
    var allStores = allStoresResp.items || [];
    var deletedStore = allStores.find(function(s) {
      return s.id === testStore.id;
    });

    if (deletedStore) {
      Logger.log("✅ Record still exists in database (soft delete confirmed)");

      var statusIds = getStatusIds_();
      if (deletedStore.status_id === statusIds.inactive) {
        Logger.log("✅ status_id correctly set to inactive");
      } else {
        Logger.log("❌ status_id not set to inactive: " + deletedStore.status_id);
      }
    } else {
      Logger.log("❌ Record not found in database (should still exist)");
    }
  }

  return deleteResult;
}

function testStoreFieldMapping() {
  // 测试字段映射是否正确（FK ID → TEXT 名称）
  Logger.log("=== Testing Store Field Mapping ===");

  // 1. 直接查询 stores 表（原始数据，包含 FK ID）
  var rawStoresResp = fetchRows_("stores", {
    limit: 5,
    schema: "tb_mgmt",
    include_deleted: "false"
  });

  if (!rawStoresResp || !rawStoresResp.ok || rawStoresResp.items.length === 0) {
    Logger.log("No stores in database");
    return;
  }

  var rawStore = rawStoresResp.items[0];
  Logger.log("\n1. Raw store data (from database):");
  Logger.log("  erp_customer_name (FK): " + rawStore.erp_customer_name + " (type: " + typeof rawStore.erp_customer_name + ")");
  Logger.log("  pos_store_name (FK): " + rawStore.pos_store_name + " (type: " + typeof rawStore.pos_store_name + ")");

  // 2. 通过 getModuleDData 获取映射后的数据
  var mappedStores = getModuleDData();
  var mappedStore = mappedStores.find(function(s) {
    return s.id === rawStore.id;
  });

  if (mappedStore) {
    Logger.log("\n2. Mapped store data (after getModuleDData):");
    Logger.log("  erp_customer_name (TEXT): " + mappedStore.erp_customer_name + " (type: " + typeof mappedStore.erp_customer_name + ")");
    Logger.log("  pos_store_name (TEXT): " + mappedStore.pos_store_name + " (type: " + typeof mappedStore.pos_store_name + ")");

    // 3. 验证映射
    if (typeof mappedStore.erp_customer_name === 'string') {
      Logger.log("✅ erp_customer_name correctly mapped to TEXT");
    } else {
      Logger.log("❌ erp_customer_name not mapped to TEXT");
    }

    if (mappedStore.pos_store_name === null || typeof mappedStore.pos_store_name === 'string') {
      Logger.log("✅ pos_store_name correctly mapped to TEXT or null");
    } else {
      Logger.log("❌ pos_store_name not mapped to TEXT: " + typeof mappedStore.pos_store_name);
    }
  }
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
