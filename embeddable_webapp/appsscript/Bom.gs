
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

