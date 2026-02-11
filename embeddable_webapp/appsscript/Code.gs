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


/* =========================================
   Module A: POS 名稱對應
   ========================================= */
function getModuleAData() {
  try {
    // 1) 查詢所有相關表（active only）
    var posItemsResp = fetchRows_("pos_items", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var posOptionGroupResp = fetchRows_("pos_option_group", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var posOptionValueResp = fetchRows_("pos_option_value", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var mappingResp = fetchRows_("pos_item_mapping", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    var productsResp = fetchRows_("products", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "false"
    });

    // 檢查查詢結果
    var posItems = (posItemsResp && posItemsResp.ok && posItemsResp.items) ? posItemsResp.items : [];
    var posOptionGroups = (posOptionGroupResp && posOptionGroupResp.ok && posOptionGroupResp.items) ? posOptionGroupResp.items : [];
    var posOptionValues = (posOptionValueResp && posOptionValueResp.ok && posOptionValueResp.items) ? posOptionValueResp.items : [];
    var mapping = (mappingResp && mappingResp.ok && mappingResp.items) ? mappingResp.items : [];
    var products = (productsResp && productsResp.ok && productsResp.items) ? productsResp.items : [];

    // 2) 獲取 status IDs
    var statusIds = getStatusIds_();

    // 3) 建立映射表（在內存中）
    // optionGroupMap: id → pos_option_group (TEXT)
    var optionGroupMap = {};
    posOptionGroups.forEach(function(og) {
      optionGroupMap[String(og.id)] = og.pos_option_group;
    });

    // optionValueMap: id → pos_option_value (TEXT)
    var optionValueMap = {};
    posOptionValues.forEach(function(ov) {
      optionValueMap[String(ov.id)] = ov.pos_option_value;
    });

    // mappingIndex: pos_item_id → [product_id, ...]
    var mappingIndex = {};
    mapping.forEach(function(m) {
      var posItemId = String(m.pos_item_id);
      if (!mappingIndex[posItemId]) {
        mappingIndex[posItemId] = [];
      }
      mappingIndex[posItemId].push(m.product_id);
    });

    // 4) 轉換 posItems 數據（字段名映射 + FK ID → TEXT 轉換）
    var posData = posItems.map(function(p) {
      // Status: status_id → "有效"/"無效"
      var statusText = (p.status_id === statusIds.active) ? "有效" : "無效";

      // Option Group: FK ID → TEXT
      var optionGroup = p.pos_option_group_id ? (optionGroupMap[String(p.pos_option_group_id)] || null) : null;

      // Option Value: FK ID → TEXT
      var optionValue = p.pos_option_value_id ? (optionValueMap[String(p.pos_option_value_id)] || null) : null;

      return {
        pos_item_id: p.id,  // id → pos_item_id
        pos_item_name: p.pos_item_name,
        pos_option_group: optionGroup,  // FK ID → TEXT
        pos_option_name: optionValue,   // FK ID → TEXT
        status: statusText,  // status_id → "有效"/"無效"
        mapped_product_ids: mappingIndex[String(p.id)] || []
      };
    });

    // 5) 轉換 products 數據（字段名映射）
    var productsData = products.map(function(p) {
      return {
        product_id: p.id,  // id → product_id
        product_name: p.product_name
      };
    });

    return { posItems: posData, products: productsData };
  } catch (e) {
    Logger.log('Exception in getModuleAData: ' + e);
    return { posItems: [], products: [] };
  }
}

function savePosMapping(posItemId, productIdsArray) {
  try {
    // 1) 獲取 status IDs
    var statusIds = getStatusIds_();

    // 2) 查詢該 pos_item_id 的所有現有映射（包含已刪除的）
    var allMappingResp = fetchRows_("pos_item_mapping", {
      limit: 200,
      schema: "tb_mgmt",
      include_deleted: "true"
    });

    if (!allMappingResp || !allMappingResp.ok) {
      throw new Error("Failed to fetch pos_item_mapping");
    }

    var allMapping = allMappingResp.items || [];

    // 3) 過濾出屬於該 pos_item_id 的記錄
    var existingMapping = allMapping.filter(function(m) {
      return String(m.pos_item_id) === String(posItemId);
    });

    // 建立映射：product_id → mapping record
    var existingMappingMap = {};
    existingMapping.forEach(function(m) {
      existingMappingMap[String(m.product_id)] = m;
    });

    // 將 productIdsArray 轉換為 Set（去重並方便查找）
    var newProductIds = {};
    productIdsArray.forEach(function(prodId) {
      if (prodId) {
        newProductIds[String(prodId)] = true;
      }
    });

    // 4) 對每個現有映射進行處理
    existingMapping.forEach(function(m) {
      var productIdStr = String(m.product_id);

      if (newProductIds[productIdStr]) {
        // 如果 product_id 仍在 newProductIds 中 → 復活（如果已刪除）或保持 active
        if (m.status_id !== statusIds.active) {
          // 復活：設置 status_id = active
          var revivedRow = {
            id: m.id,
            pos_item_id: m.pos_item_id,
            product_id: m.product_id,
            status_id: statusIds.active,
            updated_at: new Date().toISOString()
          };
          upsertRow_("pos_item_mapping", revivedRow, ["id"], "tb_mgmt");
        }
        // 如果已經是 active，不需要操作
      } else {
        // 如果不在 newProductIds 中 → 軟刪除
        if (m.status_id === statusIds.active) {
          deleteRow_("pos_item_mapping", { id: m.id }, "tb_mgmt");
        }
        // 如果已經是 inactive，不需要操作
      }
    });

    // 5) 對每個新的 product_id（不在現有映射中）→ 創建新的映射記錄
    for (var productIdStr in newProductIds) {
      if (!existingMappingMap[productIdStr]) {
        // 創建新的映射記錄
        var newMappingRow = {
          pos_item_id: posItemId,
          product_id: Number(productIdStr),
          status_id: statusIds.active,
          updated_at: new Date().toISOString()
        };

        // 不包含 id，讓數據庫自動生成
        upsertRow_("pos_item_mapping", newMappingRow, ["pos_item_id", "product_id"], "tb_mgmt");
      }
    }

    return { success: true };
  } catch (e) {
    Logger.log('Exception in savePosMapping: ' + e);
    throw e;
  }
}

function updatePosStatus(posItemId, newStatus) {
  try {
    // 1) 獲取 status IDs
    var statusIds = getStatusIds_();

    // 2) 映射中文狀態到 status_id
    var statusId;
    if (newStatus === "有效") {
      statusId = statusIds.active;
    } else if (newStatus === "無效") {
      statusId = statusIds.inactive;
    } else {
      statusId = statusIds.active;  // Default to active
    }

    // 3) 使用 fetch-then-merge 模式更新 pos_items
    // Fetch existing record
    var existingResp = fetchRow_("pos_items", "id", posItemId, "tb_mgmt", { include_deleted: true });
    Logger.log('Existing resp: ' + JSON.stringify(existingResp) );
    if (!existingResp || !existingResp.ok || !existingResp.item) {
      throw new Error("POS item not found for id: " + posItemId);
    }

    var existing = existingResp.item;
    Logger.log('Existing item: ' + JSON.stringify(existing) );

    // Merge: preserve all fields, update only status_id
    var updatedRow = {
      id: existing.id,
      pos_item_name: existing.pos_item_name,
      pos_option_group_id: existing.pos_option_group_id,
      pos_option_value_id: existing.pos_option_value_id,
      status_id: statusId,  // UPDATE
      updated_at: new Date().toISOString()
    };
    Logger.log('to update as: ' + JSON.stringify(updatedRow) );
    var upsertResult = upsertRow_("pos_items", updatedRow, ["id"], "tb_mgmt");

    if (!upsertResult || !upsertResult.ok) {
      throw new Error("Failed to update POS item status");
    }

    // 4) 返回完整數據（調用 getModuleAData）
    return getModuleAData();
  } catch (e) {
    Logger.log('Exception in updatePosStatus: ' + e);
    throw e;
  }
}

// ==========================================
// Test Functions: Module A (POS Item Mapping)
// ==========================================

function testGetModuleAData() {
  var data = getModuleAData();
  Logger.log("POS items count: " + data.posItems.length);
  Logger.log("Products count: " + data.products.length);

  if (data.posItems.length > 0) {
    Logger.log("Sample POS item: " + JSON.stringify(data.posItems[0]));

    // 驗證字段
    var sample = data.posItems[0];
    Logger.log("pos_item_id type: " + typeof sample.pos_item_id);
    Logger.log("status type: " + typeof sample.status + " (should be string)");
    Logger.log("status value: " + sample.status);
    Logger.log("mapped_product_ids length: " + sample.mapped_product_ids.length);

    // 驗證字段存在
    if (sample.pos_item_id !== undefined) {
      Logger.log("✅ Field present: pos_item_id");
    }
    if (sample.pos_item_name !== undefined) {
      Logger.log("✅ Field present: pos_item_name");
    }
    if (sample.pos_option_group !== undefined) {
      Logger.log("✅ Field present: pos_option_group (value: " + sample.pos_option_group + ")");
    }
    if (sample.pos_option_name !== undefined) {
      Logger.log("✅ Field present: pos_option_name (value: " + sample.pos_option_name + ")");
    }
  }

  if (data.products.length > 0) {
    Logger.log("Sample product: " + JSON.stringify(data.products[0]));
  }

  return data;
}

function testUpdatePosStatus() {
  // 獲取第一個 POS item
  var data = getModuleAData();
  if (data.posItems.length === 0) {
    Logger.log("No POS items found");
    return;
  }

  var testItem = data.posItems[0];
  Logger.log("Testing with POS item: " + testItem.pos_item_name + " (ID: " + testItem.pos_item_id + ")");
  Logger.log("Current status: " + testItem.status);

  // 切換狀態
  var newStatus = testItem.status === "有效" ? "無效" : "有效";
  Logger.log("Changing status to: " + newStatus);

  var result = updatePosStatus(testItem.pos_item_id, newStatus);

  // 驗證：根據新狀態決定如何查找
  if (newStatus === "無效") {
    // 如果切換為"無效"，項目不會出現在 active 列表中
    Logger.log("Status changed to '無效' - item should be removed from active list");

    // 檢查項目是否從列表中消失
    var stillInList = result.posItems.find(function(p) {
      return p.pos_item_id === testItem.pos_item_id;
    });

    if (!stillInList) {
      Logger.log("✅ Status updated successfully - item removed from active list");
      Logger.log("  Old status: " + testItem.status);
      Logger.log("  New status: " + newStatus);
      Logger.log("  Active items before: " + data.posItems.length);
      Logger.log("  Active items after: " + result.posItems.length);

      // 驗證數據庫中的實際狀態（包含已刪除的）
      var allItemsResp = fetchRows_("pos_items", {
        limit: 200,
        schema: "tb_mgmt",
        include_deleted: "true"
      });

      if (allItemsResp && allItemsResp.ok) {
        var dbItem = allItemsResp.items.find(function(p) {
          return p.id === testItem.pos_item_id;
        });

        if (dbItem) {
          var statusIds = getStatusIds_();
          if (dbItem.status_id === statusIds.inactive) {
            Logger.log("✅ Database status_id correctly set to inactive");
          } else {
            Logger.log("❌ Database status_id not set to inactive: " + dbItem.status_id);
          }
        }
      }
    } else {
      Logger.log("❌ Status update failed - item still appears in active list");
    }
  } else {
    // 如果切換為"有效"，項目應該出現在列表中
    var updatedItem = result.posItems.find(function(p) {
      return p.pos_item_id === testItem.pos_item_id;
    });

    if (updatedItem && updatedItem.status === newStatus) {
      Logger.log("✅ Status updated successfully");
      Logger.log("  Old status: " + testItem.status);
      Logger.log("  New status: " + updatedItem.status);
    } else {
      Logger.log("❌ Status update failed");
      if (updatedItem) {
        Logger.log("  Expected: " + newStatus + ", Got: " + updatedItem.status);
      } else {
        Logger.log("  Item not found in result");
      }
    }
  }

  return result;
}

function testUpdatePosStatusFullCycle() {
  // 測試完整的狀態切換循環：有效 → 無效 → 有效
  Logger.log("=== Testing Full Status Toggle Cycle ===");

  var data = getModuleAData();
  if (data.posItems.length === 0) {
    Logger.log("No POS items found");
    return;
  }

  var testItem = data.posItems[0];
  var originalStatus = testItem.status;
  Logger.log("Starting with item: " + testItem.pos_item_name + " (ID: " + testItem.pos_item_id + ")");
  Logger.log("Original status: " + originalStatus);

  // Step 1: 切換為 "無效"
  Logger.log("\n--- Step 1: Toggle to '無效' ---");
  var result1 = updatePosStatus(testItem.pos_item_id, "無效");
  var itemInList1 = result1.posItems.find(function(p) {
    return p.pos_item_id === testItem.pos_item_id;
  });

  if (!itemInList1) {
    Logger.log("✅ Step 1 passed: Item removed from active list");
  } else {
    Logger.log("❌ Step 1 failed: Item still in active list with status: " + itemInList1.status);
  }

  // Step 2: 切換回 "有效"
  Logger.log("\n--- Step 2: Toggle back to '有效' ---");
  var result2 = updatePosStatus(testItem.pos_item_id, "有效");
  var itemInList2 = result2.posItems.find(function(p) {
    return p.pos_item_id === testItem.pos_item_id;
  });

  if (itemInList2 && itemInList2.status === "有效") {
    Logger.log("✅ Step 2 passed: Item restored to active list");
    Logger.log("  Status: " + itemInList2.status);
  } else {
    Logger.log("❌ Step 2 failed");
    if (itemInList2) {
      Logger.log("  Item found but wrong status: " + itemInList2.status);
    } else {
      Logger.log("  Item not found in active list");
    }
  }

  // Summary
  Logger.log("\n=== Test Summary ===");
  Logger.log("Original status: " + originalStatus);
  Logger.log("Final status: " + (itemInList2 ? itemInList2.status : "not found"));
  Logger.log("Test result: " + (itemInList2 && itemInList2.status === "有效" ? "✅ PASSED" : "❌ FAILED"));

  return result2;
}

function testSavePosMapping() {
  // 獲取第一個 POS item 和前兩個 product
  var data = getModuleAData();
  if (data.posItems.length === 0 || data.products.length === 0) {
    Logger.log("No data found");
    return;
  }

  var testItem = data.posItems[0];
  var testProducts = data.products.slice(0, Math.min(2, data.products.length)).map(function(p) {
    return p.product_id;
  });

  Logger.log("Testing mapping for: " + testItem.pos_item_name);
  Logger.log("Current mapped products: " + JSON.stringify(testItem.mapped_product_ids));
  Logger.log("New mapping to products: " + JSON.stringify(testProducts));

  var result = savePosMapping(testItem.pos_item_id, testProducts);
  Logger.log("Save result: " + JSON.stringify(result));

  // 驗證
  var updatedData = getModuleAData();
  var updatedItem = updatedData.posItems.find(function(p) {
    return p.pos_item_id === testItem.pos_item_id;
  });

  Logger.log("Updated mapped_product_ids: " + JSON.stringify(updatedItem.mapped_product_ids));

  if (updatedItem.mapped_product_ids.length === testProducts.length) {
    Logger.log("✅ Mapping saved successfully");
    Logger.log("  Expected count: " + testProducts.length);
    Logger.log("  Actual count: " + updatedItem.mapped_product_ids.length);

    // 驗證每個 product_id 都存在
    var allMatch = testProducts.every(function(id) {
      return updatedItem.mapped_product_ids.indexOf(id) >= 0;
    });

    if (allMatch) {
      Logger.log("✅ All product IDs match");
    } else {
      Logger.log("❌ Product IDs mismatch");
    }
  } else {
    Logger.log("❌ Mapping save failed");
    Logger.log("  Expected count: " + testProducts.length);
    Logger.log("  Actual count: " + updatedItem.mapped_product_ids.length);
  }

  return result;
}

/* =========================================
   Module B: 產品與食材資料 (Supabase)
   ========================================= */

/**
 * 內部輔助：將 Supabase 原始 ingredients 映射為前端格式
 * @param {Object[]} rawIngredients - Supabase ingredients 資料
 * @param {Object} erpMap - erp_inventory id → product_code 映射
 */
function mapIngredients_(rawIngredients, erpMap) {
  return rawIngredients.map(function(i) {
    return {
      ingredient_id: i.id,
      ingredient_name: i.ingredient_name,
      is_semi_product: i.is_semi_product,
      purchase_source: i.purchase_source,
      erp_inventory_product_code: i.erp_inventory_id ? (erpMap[String(i.erp_inventory_id)] || '') : ''
    };
  });
}

/**
 * 內部輔助：將 Supabase 原始 units 映射為前端格式
 */
function mapUnits_(rawUnits) {
  return rawUnits.map(function(u) {
    return {
      unit_id: u.id,
      unit_name: u.unit_name
    };
  });
}

function getModuleBData() {
  try {
    // 1) 查詢所有相關表
    var productsResp = fetchRows_("products", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var categoriesResp = fetchRows_("product_categories", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var ingredientsResp = fetchRows_("ingredients", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var unitsResp = fetchRows_("units", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var erpResp = fetchRows_("erp_inventory", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });

    var rawProducts = (productsResp && productsResp.ok && productsResp.items) ? productsResp.items : [];
    var rawCategories = (categoriesResp && categoriesResp.ok && categoriesResp.items) ? categoriesResp.items : [];
    var rawIngredients = (ingredientsResp && ingredientsResp.ok && ingredientsResp.items) ? ingredientsResp.items : [];
    var rawUnits = (unitsResp && unitsResp.ok && unitsResp.items) ? unitsResp.items : [];
    var rawErp = (erpResp && erpResp.ok && erpResp.items) ? erpResp.items : [];

    // 2) 建立 erp_inventory id → product_code 映射（供 ingredients 使用）
    var erpMap = {};
    rawErp.forEach(function(e) {
      erpMap[String(e.id)] = e.product_code || '';
    });

    // 3) 字段名映射（id → 前端期望的欄位名）
    var products = rawProducts.map(function(p) {
      return {
        product_id: p.id,
        product_name: p.product_name,
        category_id: p.category_id
      };
    });

    var categories = rawCategories.map(function(c) {
      return {
        category_id: c.id,
        category_name: c.category_name
      };
    });

    var ingredients = mapIngredients_(rawIngredients, erpMap);
    var units = mapUnits_(rawUnits);

    // 4) semiProducts：從 ingredients 過濾
    var semiProducts = ingredients.filter(function(i) {
      return i.is_semi_product === true || String(i.is_semi_product).toLowerCase() === 'true';
    });

    return { products: products, categories: categories, semiProducts: semiProducts, ingredients: ingredients, units: units };
  } catch (e) {
    Logger.log('Exception in getModuleBData: ' + e);
    return { products: [], categories: [], semiProducts: [], ingredients: [], units: [] };
  }
}

// 單位管理功能
function createUnit(name) {
  try {
    var statusIds = getStatusIds_();
    var result = upsertRow_("units", {
      unit_name: name,
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    }, ["unit_name"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to create unit");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in createUnit: ' + e);
    throw e;
  }
}

function updateUnit(id, name) {
  try {
    var existingResp = fetchRow_("units", "id", id, "tb_mgmt");
    if (!existingResp || !existingResp.ok || !existingResp.item) {
      throw new Error("Unit not found for id: " + id);
    }
    var existing = existingResp.item;

    var result = upsertRow_("units", {
      id: existing.id,
      unit_name: name,
      status_id: existing.status_id,
      updated_at: new Date().toISOString()
    }, ["id"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to update unit");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in updateUnit: ' + e);
    throw e;
  }
}

function createProductCategory(name) {
  try {
    var statusIds = getStatusIds_();
    var result = upsertRow_("product_categories", {
      category_name: name,
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    }, ["category_name"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to create product category");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in createProductCategory: ' + e);
    throw e;
  }
}

function createNewProduct(name, categoryId) {
  try {
    var statusIds = getStatusIds_();
    var result = upsertRow_("products", {
      product_name: name,
      category_id: categoryId,
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    }, ["product_name"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to create product");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in createNewProduct: ' + e);
    throw e;
  }
}

function updateProduct(productId, name, categoryId) {
  try {
    var existingResp = fetchRow_("products", "id", productId, "tb_mgmt");
    if (!existingResp || !existingResp.ok || !existingResp.item) {
      throw new Error("Product not found for id: " + productId);
    }
    var existing = existingResp.item;

    var result = upsertRow_("products", {
      id: existing.id,
      product_name: name,
      category_id: categoryId,
      status_id: existing.status_id,
      updated_at: new Date().toISOString()
    }, ["id"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to update product");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in updateProduct: ' + e);
    throw e;
  }
}

function createNewIngredient(name, source, isSemi) {
  try {
    var statusIds = getStatusIds_();
    var result = upsertRow_("ingredients", {
      ingredient_name: name,
      purchase_source: source,
      is_semi_product: (isSemi === 'true' || isSemi === true),
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    }, ["id"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to create ingredient");
    }
    return { success: true };
  } catch (e) {
    Logger.log('Exception in createNewIngredient: ' + e);
    throw e;
  }
}

function updateIngredientDetails(id, name, source, isSemi) {
  try {
    var existingResp = fetchRow_("ingredients", "id", id, "tb_mgmt");
    if (!existingResp || !existingResp.ok || !existingResp.item) {
      throw new Error("Ingredient not found for id: " + id);
    }
    var existing = existingResp.item;

    var result = upsertRow_("ingredients", {
      id: existing.id,
      ingredient_name: name,
      purchase_source: source,
      is_semi_product: (isSemi === 'true' || isSemi === true),
      erp_inventory_id: existing.erp_inventory_id,
      status_id: existing.status_id,
      updated_at: new Date().toISOString()
    }, ["id"], "tb_mgmt");

    if (!result || !result.ok) {
      throw new Error("Failed to update ingredient");
    }
    return getModuleBData();
  } catch (e) {
    Logger.log('Exception in updateIngredientDetails: ' + e);
    throw e;
  }
}

function getBomDetail(itemId, type) {
  try {
    var tableName = type === 'product' ? "product_bom" : "semi_product_bom";
    var fkCol = type === 'product' ? 'product_id' : 'semi_product_id';

    // 1) 查詢 BOM 表、ingredients、units
    var bomResp = fetchRows_(tableName, { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var ingredientsResp = fetchRows_("ingredients", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var unitsResp = fetchRows_("units", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });
    var erpResp = fetchRows_("erp_inventory", { limit: 200, schema: "tb_mgmt", include_deleted: "false" });

    var allBom = (bomResp && bomResp.ok && bomResp.items) ? bomResp.items : [];
    var rawIngredients = (ingredientsResp && ingredientsResp.ok && ingredientsResp.items) ? ingredientsResp.items : [];
    var rawUnits = (unitsResp && unitsResp.ok && unitsResp.items) ? unitsResp.items : [];
    var rawErp = (erpResp && erpResp.ok && erpResp.items) ? erpResp.items : [];

    // 2) 建立查詢映射
    var ingMap = {};
    rawIngredients.forEach(function(i) { ingMap[String(i.id)] = i.ingredient_name; });

    var unitMap = {};
    rawUnits.forEach(function(u) { unitMap[String(u.id)] = u.unit_name; });

    var erpMap = {};
    rawErp.forEach(function(e) { erpMap[String(e.id)] = e.product_code || ''; });

    // 3) 過濾並豐富 BOM 資料
    var bomRows = allBom.filter(function(b) { return String(b[fkCol]) === String(itemId); });
    var enrichedBom = bomRows.map(function(b) {
      return {
        bom_id: b.id,
        ingredient_id: b.ingredient_id,
        quantity: b.quantity,
        unit_id: b.unit_id,
        ingredient_name: ingMap[String(b.ingredient_id)] || 'Unknown',
        unit_name: unitMap[String(b.unit_id)] || 'Unknown'
      };
    });

    // 4) 映射 ingredients 和 units 為前端格式
    var ingredients = mapIngredients_(rawIngredients, erpMap);
    var units = mapUnits_(rawUnits);

    return { bom: enrichedBom, ingredients: ingredients, units: units };
  } catch (e) {
    Logger.log('Exception in getBomDetail: ' + e);
    return { bom: [], ingredients: [], units: [] };
  }
}

function addBomItem(itemId, type, ingredientId, quantity, unitId) {
  try {
    var tableName = type === 'product' ? "product_bom" : "semi_product_bom";
    var fkCol = type === 'product' ? 'product_id' : 'semi_product_id';

    var statusIds = getStatusIds_();
    var row = {
      ingredient_id: ingredientId,
      quantity: quantity,
      unit_id: unitId,
      status_id: statusIds.active,
      updated_at: new Date().toISOString()
    };
    row[fkCol] = itemId;

    var result = upsertRow_(tableName, row, ["id"], "tb_mgmt");
    if (!result || !result.ok) {
      throw new Error("Failed to add BOM item");
    }
    return getBomDetail(itemId, type);
  } catch (e) {
    Logger.log('Exception in addBomItem: ' + e);
    throw e;
  }
}

function removeBomItem(bomId, itemId, type) {
  try {
    var tableName = type === 'product' ? "product_bom" : "semi_product_bom";

    var result = deleteRow_(tableName, { id: bomId }, "tb_mgmt");
    if (!result || !result.ok) {
      throw new Error("Failed to remove BOM item");
    }
    return getBomDetail(itemId, type);
  } catch (e) {
    Logger.log('Exception in removeBomItem: ' + e);
    throw e;
  }
}

// ==========================================
// Test Functions: Module B (Products & Ingredients)
// ==========================================

function testGetModuleBData() {
  var data = getModuleBData();
  Logger.log("Products count: " + data.products.length);
  Logger.log("Categories count: " + data.categories.length);
  Logger.log("Ingredients count: " + data.ingredients.length);
  Logger.log("Units count: " + data.units.length);
  Logger.log("SemiProducts count: " + data.semiProducts.length);

  if (data.products.length > 0) {
    var p = data.products[0];
    Logger.log("Sample product: " + JSON.stringify(p));
    Logger.log("Fields: " + Object.keys(p).join(", "));
    if (p.product_id !== undefined) Logger.log("✅ product_id present");
    if (p.product_name !== undefined) Logger.log("✅ product_name present");
    if (p.category_id !== undefined) Logger.log("✅ category_id present");
  }

  if (data.categories.length > 0) {
    var c = data.categories[0];
    Logger.log("Sample category: " + JSON.stringify(c));
    if (c.category_id !== undefined) Logger.log("✅ category_id present");
    if (c.category_name !== undefined) Logger.log("✅ category_name present");
  }

  if (data.ingredients.length > 0) {
    var i = data.ingredients[0];
    Logger.log("Sample ingredient: " + JSON.stringify(i));
    if (i.ingredient_id !== undefined) Logger.log("✅ ingredient_id present");
    if (i.ingredient_name !== undefined) Logger.log("✅ ingredient_name present");
    if (i.is_semi_product !== undefined) Logger.log("✅ is_semi_product present (value: " + i.is_semi_product + ")");
    if (i.erp_inventory_product_code !== undefined) Logger.log("✅ erp_inventory_product_code present (value: " + i.erp_inventory_product_code + ")");
  }

  if (data.units.length > 0) {
    var u = data.units[0];
    Logger.log("Sample unit: " + JSON.stringify(u));
    if (u.unit_id !== undefined) Logger.log("✅ unit_id present");
    if (u.unit_name !== undefined) Logger.log("✅ unit_name present");
  }

  return data;
}

function testCreateAndUpdateUnit() {
  Logger.log("=== Test: Create and Update Unit ===");

  // Create
  var testName = "測試單位_" + new Date().getTime();
  Logger.log("Creating unit: " + testName);
  var data1 = createUnit(testName);
  var created = data1.units.find(function(u) { return u.unit_name === testName; });
  if (created) {
    Logger.log("✅ Unit created: " + JSON.stringify(created));
  } else {
    Logger.log("❌ Unit not found after creation");
    return;
  }

  // Update
  var updatedName = testName + "_updated";
  Logger.log("Updating unit to: " + updatedName);
  var data2 = updateUnit(created.unit_id, updatedName);
  var updated = data2.units.find(function(u) { return u.unit_id === created.unit_id; });
  if (updated && updated.unit_name === updatedName) {
    Logger.log("✅ Unit updated: " + JSON.stringify(updated));
  } else {
    Logger.log("❌ Unit update failed");
  }
}

function testCreateAndUpdateProduct() {
  Logger.log("=== Test: Create and Update Product ===");

  var data = getModuleBData();
  if (data.categories.length === 0) {
    Logger.log("No categories found. Cannot test.");
    return;
  }

  var catId = data.categories[0].category_id;

  // Create
  var testName = "測試產品_" + new Date().getTime();
  Logger.log("Creating product: " + testName + " (category: " + catId + ")");
  var data1 = createNewProduct(testName, catId);
  var created = data1.products.find(function(p) { return p.product_name === testName; });
  if (created) {
    Logger.log("✅ Product created: " + JSON.stringify(created));
  } else {
    Logger.log("❌ Product not found after creation");
    return;
  }

  // Update
  var updatedName = testName + "_updated";
  Logger.log("Updating product to: " + updatedName);
  var data2 = updateProduct(created.product_id, updatedName, catId);
  var updated = data2.products.find(function(p) { return p.product_id === created.product_id; });
  if (updated && updated.product_name === updatedName) {
    Logger.log("✅ Product updated: " + JSON.stringify(updated));
  } else {
    Logger.log("❌ Product update failed");
  }
}

function testBomCycle() {
  Logger.log("=== Test: BOM Add and Remove Cycle ===");

  var data = getModuleBData();
  if (data.products.length === 0 || data.ingredients.length === 0 || data.units.length === 0) {
    Logger.log("Not enough data to test BOM. Need products, ingredients, and units.");
    return;
  }

  var productId = data.products[0].product_id;
  var ingredientId = data.ingredients[0].ingredient_id;
  var unitId = data.units[0].unit_id;

  // Add BOM item
  Logger.log("Adding BOM: product=" + productId + " ingredient=" + ingredientId + " qty=1 unit=" + unitId);
  var result1 = addBomItem(productId, 'product', ingredientId, 1, unitId);
  Logger.log("BOM count after add: " + result1.bom.length);

  if (result1.bom.length > 0) {
    var last = result1.bom[result1.bom.length - 1];
    Logger.log("Last BOM item: " + JSON.stringify(last));
    if (last.bom_id !== undefined) Logger.log("✅ bom_id present");
    if (last.ingredient_name !== undefined) Logger.log("✅ ingredient_name enriched: " + last.ingredient_name);
    if (last.unit_name !== undefined) Logger.log("✅ unit_name enriched: " + last.unit_name);

    // Remove BOM item
    Logger.log("Removing BOM item: " + last.bom_id);
    var result2 = removeBomItem(last.bom_id, productId, 'product');
    Logger.log("BOM count after remove: " + result2.bom.length);

    var stillExists = result2.bom.find(function(b) { return b.bom_id === last.bom_id; });
    if (!stillExists) {
      Logger.log("✅ BOM item removed successfully");
    } else {
      Logger.log("❌ BOM item still exists after removal");
    }
  } else {
    Logger.log("❌ No BOM items found after add");
  }
}

function testIngredientCycle() {
  Logger.log("=== Test: Ingredient Create / Edit / Delete ===");

  // --- Create ---
  var name = "測試食材_" + new Date().getTime();
  Logger.log("Creating ingredient: " + name);
  var createResult = createNewIngredient(name, "總部叫貨", "false");
  if (!createResult || !createResult.success) {
    Logger.log("❌ Create failed");
    return;
  }
  Logger.log("✅ createNewIngredient returned success");

  // 驗證：從 getModuleBData 找到新建的食材
  var data1 = getModuleBData();
  var created = data1.ingredients.find(function(i) { return i.ingredient_name === name; });
  if (!created) {
    Logger.log("❌ Ingredient not found after creation");
    return;
  }
  Logger.log("✅ Ingredient created: " + JSON.stringify(created));
  if (created.is_semi_product === false || String(created.is_semi_product).toLowerCase() === 'false') {
    Logger.log("✅ is_semi_product = false (一般食材)");
  } else {
    Logger.log("❌ is_semi_product should be false, got: " + created.is_semi_product);
  }
  if (created.purchase_source === "總部叫貨") {
    Logger.log("✅ purchase_source correct");
  }

  // --- Edit ---
  var updatedName = name + "_edited";
  Logger.log("\nUpdating ingredient to: " + updatedName + ", source=自行採購");
  var data2 = updateIngredientDetails(created.ingredient_id, updatedName, "自行採購", "false");
  var updated = data2.ingredients.find(function(i) { return i.ingredient_id === created.ingredient_id; });
  if (updated && updated.ingredient_name === updatedName && updated.purchase_source === "自行採購") {
    Logger.log("✅ Ingredient updated: " + JSON.stringify(updated));
  } else {
    Logger.log("❌ Update failed. Got: " + JSON.stringify(updated));
  }

  // --- Delete (soft) ---
  Logger.log("\nDeleting ingredient id=" + created.ingredient_id);
  var delResult = deleteRow_("ingredients", { id: created.ingredient_id }, "tb_mgmt");
  if (delResult && delResult.ok) {
    Logger.log("✅ deleteRow_ returned ok");
  } else {
    Logger.log("❌ deleteRow_ failed: " + JSON.stringify(delResult));
  }

  // 驗證：不再出現在 active 列表
  var data3 = getModuleBData();
  var stillExists = data3.ingredients.find(function(i) { return i.ingredient_id === created.ingredient_id; });
  if (!stillExists) {
    Logger.log("✅ Ingredient removed from active list (soft delete confirmed)");
  } else {
    Logger.log("❌ Ingredient still in active list after delete");
  }

  // 驗證：仍存在於資料庫（include_deleted）
  var dbResp = fetchRow_("ingredients", "id", created.ingredient_id, "tb_mgmt", { include_deleted: true });
  if (dbResp && dbResp.ok && dbResp.item) {
    var statusIds = getStatusIds_();
    if (dbResp.item.status_id === statusIds.inactive) {
      Logger.log("✅ Record still in DB with status_id = inactive");
    } else {
      Logger.log("❌ Record in DB but status_id = " + dbResp.item.status_id);
    }
  } else {
    Logger.log("❌ Record not found in DB at all");
  }

  Logger.log("\n=== Ingredient Cycle: DONE ===");
}

function testSemiProductCycle() {
  Logger.log("=== Test: Semi-Product Create / Edit / Delete ===");

  // --- Create (is_semi_product = true) ---
  var name = "測試半成品_" + new Date().getTime();
  Logger.log("Creating semi-product: " + name);
  var createResult = createNewIngredient(name, "自行採購", "true");
  if (!createResult || !createResult.success) {
    Logger.log("❌ Create failed");
    return;
  }
  Logger.log("✅ createNewIngredient returned success");

  // 驗證：出現在 ingredients 和 semiProducts
  var data1 = getModuleBData();
  var created = data1.ingredients.find(function(i) { return i.ingredient_name === name; });
  if (!created) {
    Logger.log("❌ Semi-product not found in ingredients");
    return;
  }
  Logger.log("✅ Found in ingredients: " + JSON.stringify(created));

  if (created.is_semi_product === true || String(created.is_semi_product).toLowerCase() === 'true') {
    Logger.log("✅ is_semi_product = true");
  } else {
    Logger.log("❌ is_semi_product should be true, got: " + created.is_semi_product);
  }

  var inSemiList = data1.semiProducts.find(function(s) { return s.ingredient_id === created.ingredient_id; });
  if (inSemiList) {
    Logger.log("✅ Also present in semiProducts list");
  } else {
    Logger.log("❌ NOT found in semiProducts list");
  }

  // --- Edit: 改名稱 + 切換為一般食材 ---
  var updatedName = name + "_edited";
  Logger.log("\nUpdating: name → " + updatedName + ", is_semi_product → false");
  var data2 = updateIngredientDetails(created.ingredient_id, updatedName, "自行採購", "false");
  var updated = data2.ingredients.find(function(i) { return i.ingredient_id === created.ingredient_id; });
  if (updated && updated.ingredient_name === updatedName) {
    Logger.log("✅ Name updated: " + updated.ingredient_name);
  } else {
    Logger.log("❌ Name update failed");
  }

  if (updated && (updated.is_semi_product === false || String(updated.is_semi_product).toLowerCase() === 'false')) {
    Logger.log("✅ is_semi_product changed to false");
  } else {
    Logger.log("❌ is_semi_product should be false, got: " + (updated ? updated.is_semi_product : "N/A"));
  }

  var stillInSemi = data2.semiProducts.find(function(s) { return s.ingredient_id === created.ingredient_id; });
  if (!stillInSemi) {
    Logger.log("✅ Removed from semiProducts list after toggling to false");
  } else {
    Logger.log("❌ Still in semiProducts list after toggling to false");
  }

  // --- Edit: 切換回半成品 ---
  Logger.log("\nToggling back: is_semi_product → true");
  var data3 = updateIngredientDetails(created.ingredient_id, updatedName, "自行採購", "true");
  var toggled = data3.semiProducts.find(function(s) { return s.ingredient_id === created.ingredient_id; });
  if (toggled) {
    Logger.log("✅ Re-appeared in semiProducts list");
  } else {
    Logger.log("❌ NOT in semiProducts list after toggling back to true");
  }

  // --- Delete (soft) ---
  Logger.log("\nDeleting semi-product id=" + created.ingredient_id);
  var delResult = deleteRow_("ingredients", { id: created.ingredient_id }, "tb_mgmt");
  if (delResult && delResult.ok) {
    Logger.log("✅ deleteRow_ returned ok");
  } else {
    Logger.log("❌ deleteRow_ failed");
  }

  var data4 = getModuleBData();
  var inIngredients = data4.ingredients.find(function(i) { return i.ingredient_id === created.ingredient_id; });
  var inSemi = data4.semiProducts.find(function(s) { return s.ingredient_id === created.ingredient_id; });
  if (!inIngredients && !inSemi) {
    Logger.log("✅ Removed from both ingredients and semiProducts (soft delete confirmed)");
  } else {
    Logger.log("❌ Still found after delete — ingredients: " + !!inIngredients + ", semiProducts: " + !!inSemi);
  }

  Logger.log("\n=== Semi-Product Cycle: DONE ===");
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
