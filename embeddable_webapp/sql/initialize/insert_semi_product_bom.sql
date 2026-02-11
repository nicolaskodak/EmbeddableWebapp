WITH raw(quantity, semi_product_name, ingredient_name, unit_name) AS (
  VALUES
    (155::numeric,  '鮪魚玉米', '鮪魚罐頭', 'g'),
    (30::numeric,   '鮪魚玉米', 'IN沙拉醬', 'g'),
    (150::numeric,  '鮪魚玉米', '玉米粒',   'g'),
    (5::numeric,    '鮪魚玉米', '黑胡椒粗粒','g'),
    (1200::numeric, '基底茶',   '茶葉包',   'g'),
    (500::numeric,  '基底茶',   '琥珀糖漿', 'g')
),
resolved AS (
  SELECT
    r.quantity,
    sp.id  AS semi_product_id,
    ing.id AS ingredient_id,
    u.id   AS unit_id
  FROM raw r
  JOIN tb_mgmt.ingredients sp
    ON sp.ingredient_name = r.semi_product_name
   AND sp.is_semi_product = TRUE
  JOIN tb_mgmt.ingredients ing
    ON ing.ingredient_name = r.ingredient_name
  JOIN tb_mgmt.units u
    ON u.unit_name = r.unit_name
)
INSERT INTO tb_mgmt.semi_product_bom (semi_product_id, ingredient_id, quantity, unit_id)
SELECT semi_product_id, ingredient_id, quantity, unit_id
FROM resolved
ON CONFLICT (ingredient_id) DO UPDATE
SET
  semi_product_id = EXCLUDED.semi_product_id,
  quantity        = EXCLUDED.quantity,
  unit_id         = EXCLUDED.unit_id
;