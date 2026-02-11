-- 建立/更新 bom_mapping view (product bom 與 semi product bom 的整合視圖)
-- 來源：
--   1) products -> product_bom -> ingredients
--   2) ingredients(半成品) -> semi_product_bom -> ingredients
CREATE OR REPLACE VIEW tb_mgmt.bom_mapping AS
WITH product_part AS (
  SELECT
    pb.id AS id,
    pc.category_name AS product_category,
    p.product_name AS product_name,
    CASE
      WHEN i.is_semi_product IS TRUE THEN 'semi_product'
      WHEN i.id IS NULL THEN NULL
      ELSE 'ingredient'
    END AS component_type,
    i.ingredient_name AS material_name,
    pb.quantity AS standard_quantity,
    u.unit_name AS unit,
    GREATEST(pb.updated_at, p.updated_at, i.updated_at, u.updated_at) AS loaded_at
  FROM tb_mgmt.product_bom pb
  JOIN tb_mgmt.products p
    ON p.id = pb.product_id
  LEFT JOIN tb_mgmt.product_categories pc
    ON pc.id = p.category_id
  LEFT JOIN tb_mgmt.ingredients i
    ON i.id = pb.ingredient_id
  JOIN tb_mgmt.units u
    ON u.id = pb.unit_id
),
semi_product_part AS (
  SELECT
    -- 避免與 product_bom 的 id 撞號：用固定偏移量做區隔
    (spb.id + 1000000000000::BIGINT) AS id,
    'semi_product'::TEXT AS product_category,
    sp.ingredient_name AS product_name,
    CASE
      WHEN i.is_semi_product IS TRUE THEN 'semi_product'
      ELSE 'ingredient'
    END AS component_type,
    i.ingredient_name AS material_name,
    spb.quantity AS standard_quantity,
    u.unit_name AS unit,
    GREATEST(spb.updated_at, sp.updated_at, i.updated_at, u.updated_at) AS loaded_at
  FROM tb_mgmt.semi_product_bom spb
  JOIN tb_mgmt.ingredients sp
    ON sp.id = spb.semi_product_id
  JOIN tb_mgmt.ingredients i
    ON i.id = spb.ingredient_id
  JOIN tb_mgmt.units u
    ON u.id = spb.unit_id
)
SELECT
  id,
  product_category,
  product_name,
  component_type,
  material_name,
  standard_quantity,
  unit,
  loaded_at
FROM product_part
UNION ALL
SELECT
  id,
  product_category,
  product_name,
  component_type,
  material_name,
  standard_quantity,
  unit,
  loaded_at
FROM semi_product_part;