-- 1) 移除現有的單欄 UNIQUE
ALTER TABLE tb_mgmt.semi_product_bom
  DROP CONSTRAINT semi_product_bom_ingredient_id_key;

-- 2) 加入複合 UNIQUE（可選，防止同一半成品重複加入同一食材）
ALTER TABLE tb_mgmt.semi_product_bom
  ADD CONSTRAINT semi_product_bom_semi_product_ingredient_unique
  UNIQUE (semi_product_id, ingredient_id);