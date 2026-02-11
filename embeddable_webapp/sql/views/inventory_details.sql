
-- inventory_details
-- inventory_details table + erp_inventory + units 組合出的庫存明細 view
-- 注意：tb_mgmt.inventory_details 已存在為 table，因此此處建立為 tb_mgmt.inventory_details_view
CREATE OR REPLACE VIEW tb_mgmt.inventory_details_view AS
SELECT
	d.id,
	d.category,
	e.product_code AS item_code,
	e.erp_inventory_name AS item_name,
	u.unit_name AS unit,
	d.shelf_life_days AS expiration_period,
	d.shelf_life_category AS expiration_category,
	d.rank AS sales_rank,
	d.lead_time_days AS lead_time,
	d.delivery AS delivery_method,
	d.max_purchase_param AS dispatch_parameter,
	d.safety_stock_param AS safety_stock_parameter,
	d.inventory_turnover_days,
	GREATEST(
		COALESCE(d.updated_at, d.created_at),
		COALESCE(e.updated_at, e.created_at),
		COALESCE(u.updated_at, u.created_at)
	) AS loaded_at
FROM tb_mgmt.inventory_details d
JOIN tb_mgmt.erp_inventory e
	ON e.id = d.erp_inventory_id
LEFT JOIN tb_mgmt.units u
	ON u.id = e.inventory_unit_id;

