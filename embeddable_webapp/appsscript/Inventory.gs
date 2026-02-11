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

/* =========================================
   Test Module E: 測試案例
   ========================================= */
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
