// ==========================================
// Generic Helpers
// ==========================================

// Tool.gs 原本只用於測試；實際對 Supabase Edge Function 的呼叫邏輯以 Code.gs 的
// `callSupabaseEdgeJson_()` 為準，避免重複維護。

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
  return callSupabaseEdgeJson_("post", null, payload);
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
  return callSupabaseEdgeJson_("post", null, payload);
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

// ==========================================
// Test Functions: Inventory Details Table
// ==========================================



function testUpsertInventoryDetail() {
  const row = {
    category: "長效*熱銷",
    rank: 1,
    item_code: "A00002",
    item_name: "◎豬排肉肉肉",
    shelf_life_days: 365,
    shelf_life_category: "長效*",
    sales_grade: "熱銷",
    lead_time_days: 7,
    delivery: "W2、5；W5會較多",
    max_purchase_param: 7,
    safety_stock_param: 10,
    inventory_turnover_days: 17.5
  };
  return upsertRow_("inventory_details", row, ["item_code"]);
}

function testUpdateInventoryDetail() {
  // 同 item_code 會更新（依 ON CONFLICT item_code）
  return upsertRow_("inventory_details", {
    item_code: "A00002",
    delivery: "W2、5；W5會較多（更新測試）",
    lead_time_days: 7
  }, ["item_code"]);
}

function testGetInventoryDetail() {
  // getInventoryDetailByItemCode_("A00002");
  return fetchRows_("inventory_details", { col: "item_code", val: "A00002" });
}

function testListInventoryDetails() {
  // listInventoryDetails_(20);
  return fetchRows_("inventory_details", { limit: 20 || 50 });
}

function testDeleteInventoryDetail() {
  // deleteInventoryDetailByItemCode_("A00002");
  return deleteRow_("inventory_details", { item_code: "A00002" });
}
