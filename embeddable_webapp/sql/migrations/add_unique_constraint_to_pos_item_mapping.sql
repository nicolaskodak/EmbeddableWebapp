ALTER TABLE tb_mgmt.pos_item_mapping
ADD CONSTRAINT pos_item_mapping_pos_item_product_unique 
UNIQUE (pos_item_id, product_id);
