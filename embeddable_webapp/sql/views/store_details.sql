
-- store_details
-- stores + pos_stores + erp_customers 組合出的門市資訊 view
CREATE OR REPLACE VIEW tb_mgmt.store_details AS
SELECT
	s.id,
	ps.pos_store_name AS pos_store_name,
	ec.erp_customer_name AS erp_customer_name,
	s.address_zh AS address_zhtw,
	s.address_en,
	s.country,
	s.city,
	s.district,
	s.latitude,
	s.longitude,
	s.store_type,
	s.status_id,
	GREATEST(
		COALESCE(s.updated_at, s.created_at),
		COALESCE(ps.updated_at, ps.created_at),
		COALESCE(ec.updated_at, ec.created_at)
	) AS loaded_at
FROM tb_mgmt.stores s
LEFT JOIN tb_mgmt.pos_stores ps
	ON ps.id = s.pos_store_name
JOIN tb_mgmt.erp_customers ec
	ON ec.id = s.erp_customer_name;

