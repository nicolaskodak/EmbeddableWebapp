
-- bom_material
-- BOM 原料主檔 view（來源：ingredients）
CREATE OR REPLACE VIEW tb_mgmt.bom_material AS
SELECT
	i.id,
	i.ingredient_name AS material_name,
	i.purchase_source AS procurement_type,
	COALESCE(i.updated_at, i.created_at) AS loaded_at
FROM tb_mgmt.ingredients i;

