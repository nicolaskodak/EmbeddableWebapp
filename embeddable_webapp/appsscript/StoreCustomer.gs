
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

