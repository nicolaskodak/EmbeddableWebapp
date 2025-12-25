// ==========================================
// Generic Helpers
// ==========================================

/**
 * 呼叫 Edge Function 的通用函式
 */
function callEdgeFunction_(method, params, payload) {
  const baseUrl = PropertiesService.getScriptProperties().getProperty("SUPABASE_URL");
  const apiKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
  
  if (!baseUrl || !apiKey) {
    Logger.log("Error: Missing SUPABASE_URL or API_KEY in Script Properties");
    return;
  }

  let url = baseUrl;
  if (params) {
    const queryString = Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    url += `?${queryString}`;
  }

  const options = {
    method: method,
    contentType: "application/json",
    headers: { "x-sync-key": apiKey, "Authorization": `Bearer ${apiKey}` },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  Logger.log(`Calling ${method.toUpperCase()} ${url}`);
  if (payload) Logger.log(`Payload: ${JSON.stringify(payload)}`);

  const res = UrlFetchApp.fetch(url, options);
  Logger.log(`Response Code: ${res.getResponseCode()}`);
  Logger.log(`Response Body: ${res.getContentText()}`);
  return res;
}

/**
 * 通用 Upsert (新增或更新)
 * @param {string} table 表格名稱
 * @param {Object} row 資料列物件
 * @param {string[]} conflictColumns 衝突判斷欄位 (例如 ['id'] 或 ['name'])
 */
function upsertRow_(table, row, conflictColumns) {
  const payload = {
    op: "upsert",
    event_id: Utilities.getUuid(),
    table: table,
    row: row,
    conflict_columns: conflictColumns
  };
  return callEdgeFunction_("post", null, payload);
}

/**
 * 通用 Delete (刪除)
 * @param {string} table 表格名稱
 * @param {Object} filter 刪除條件 (例如 { id: 123 } 或 { name: "apple" })
 */
function deleteRow_(table, filter) {
  const payload = {
    op: "delete",
    event_id: Utilities.getUuid(),
    table: table,
    filter: filter
  };
  return callEdgeFunction_("post", null, payload);
}

/**
 * 通用 Fetch (查詢)
 * @param {string} table 表格名稱
 * @param {Object} queryParams 查詢參數 (例如 { limit: 10, col: "name", val: "apple" })
 */
function fetchRows_(table, queryParams) {
  const params = { table: table, ...queryParams };
  return callEdgeFunction_("get", params, null);
}

// ==========================================
// Test Functions: Items Table
// ==========================================

function testUpsertItem() {
  upsertRow_("items", {
    name: "banana",
    qty: 50,
    updated_at: new Date().toISOString()
  }, ["name"]);
}

function testDeleteItem() {
  // Items 表格使用 name 作為刪除條件
  deleteRow_("items", { name: "banana" });
}

function testGetItem() {
  fetchRows_("items", { col: "name", val: "banana" });
}

// ==========================================
// Test Functions: Stores Table
// ==========================================

function testCreateStore() {
  // 新增 Store (不帶 ID，依賴 DB 自動遞增)
  upsertRow_("stores", {
    erp_customer_name: "Test Store " + new Date().getTime(),
    pos_store_name: "POS Store Test",
    store_status: "active",
    address_zhtw: "Test Address",
    country: "Taiwan"
  });
}

function testUpdateStore() {
  // 更新 Store (必須提供 ID)
  // 請將 storeId 替換為實際存在的 ID
  const storeId = 1; 
  upsertRow_("stores", {
    id: storeId,
    erp_customer_name: "Test Store " + new Date().getTime(),
    pos_store_name: "Updated POS Name " + new Date().getTime(),
    store_status: "inactive"
  }, ["id"]);
}

function testDeleteStore() {
  // 刪除 Store (使用 ID)
  // 請將 storeId 替換為實際要刪除的 ID
  const storeId = 1; 
  deleteRow_("stores", { id: storeId });
}

function testListStores() {
  fetchRows_("stores", { limit: 5 });
}