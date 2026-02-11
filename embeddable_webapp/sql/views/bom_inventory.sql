-- bom_inventory
-- unit_conversions + erp_inventory + units 組合出的 BOM 庫存/單位換算 view
CREATE OR REPLACE VIEW tb_mgmt.bom_inventory AS
SELECT
  uc.id,
  ROW_NUMBER() OVER (ORDER BY e.product_code, e.erp_inventory_name, uc.id) AS sequence_no,
  e.erp_inventory_name,
  e.erp_inventory_name AS material_name,
  inv_u.unit_name AS inventory_unit,
  NULL::TEXT AS product_spec_data,
  NULL::TEXT AS weight_data,
  out_base_u.unit_name AS usage_min_unit,
  uc.warehouse_out_quantity AS usage_content_quantity,
  out_u.unit_name AS usage_content_unit,
  GREATEST(
    COALESCE(uc.updated_at, uc.created_at),
    COALESCE(e.updated_at, e.created_at),
    COALESCE(inv_u.updated_at, inv_u.created_at),
    COALESCE(out_u.updated_at, out_u.created_at),
    COALESCE(out_base_u.updated_at, out_base_u.created_at)
  ) AS loaded_at
FROM tb_mgmt.unit_conversions uc
JOIN tb_mgmt.erp_inventory e
  ON e.id = uc.erp_inventory_id
LEFT JOIN tb_mgmt.units inv_u
  ON inv_u.id = e.inventory_unit_id
LEFT JOIN tb_mgmt.units out_u
  ON out_u.id = uc.warehouse_out_unit_id
LEFT JOIN tb_mgmt.units out_base_u
  ON out_base_u.id = uc.warehouse_out_base_unit_id;
