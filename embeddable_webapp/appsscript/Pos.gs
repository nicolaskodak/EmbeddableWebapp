
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
