
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

