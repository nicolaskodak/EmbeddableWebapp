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
/*
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
*/
/**
 * 通用 Delete (刪除)
 * @param {string} table 表格名稱
 * @param {Object} filter 刪除條件 (例如 { id: 123 } 或 { name: "apple" })
 */
 /*
function deleteRow_(table, filter) {
  const payload = {
    op: "delete",
    event_id: Utilities.getUuid(),
    table: table,
    filter: filter
  };
  return callSupabaseEdgeJson_("post", null, payload);
}
*/

/**
 * 通用 Fetch (查詢)
 * @param {string} table 表格名稱
 * @param {Object} queryParams 查詢參數 (例如 { limit: 10, col: "name", val: "apple" })
 */
 /*
function fetchRows_(table, queryParams) {
  const params = { table: table, ...queryParams };
  return callSupabaseEdgeJson_("get", params, null);
}
*/

/**
 * 通用 Fetch Single Row (單筆查詢)
 * @param {string} table 表格名稱
 * @param {string} column 查詢欄位名稱
 * @param {*} value 查詢值
 * @param {string} [schema] 可選的 schema (例如 'tb_mgmt')
 * @return {Object} Edge Function 回應 { ok: true, item: {...} } 或 { ok: true, item: null }
 */
 /*
function fetchRow_(table, column, value, schema) {
  const params = { table: table, col: column, val: value };
  if (schema) { params.schema = schema; }
  return callSupabaseEdgeJson_("get", params, null);
}
*/

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
    erp_customer_name: "測試客戶 " + new Date().getTime(),
    pos_store_name: "測試 POS 門店 " + new Date().getTime(),
    address_zh: "台北市信義區信義路五段7號",
    address_en: "No.7, Sec. 5, Xinyi Rd., Xinyi Dist., Taipei City",
    country: "台灣",
    city: "台北市",
    district: "信義區",
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

