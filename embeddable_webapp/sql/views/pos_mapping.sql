
-- pos_mapping
-- POS 商品對照與選項設定 view
CREATE OR REPLACE VIEW tb_mgmt.pos_mapping AS
SELECT
	pim.id,
	p.product_name AS pos_product_name,
	pi.pos_item_name,
	pov.pos_option_value AS pos_option_name,
	pog.pos_option_group AS replacement_option,
	p.product_name AS content,
	GREATEST(
		COALESCE(pim.updated_at, pim.created_at),
		COALESCE(p.updated_at, p.created_at),
		COALESCE(pi.updated_at, pi.created_at),
		COALESCE(pog.updated_at, pog.created_at),
		COALESCE(pov.updated_at, pov.created_at)
	) AS loaded_at
FROM tb_mgmt.pos_item_mapping pim
JOIN tb_mgmt.products p
	ON p.id = pim.product_id
JOIN tb_mgmt.pos_items pi
	ON pi.id = pim.pos_item_id
LEFT JOIN tb_mgmt.pos_option_group pog
	ON pog.id = pi.pos_option_group_id
LEFT JOIN tb_mgmt.pos_option_value pov
	ON pov.id = pi.pos_option_value_id;

