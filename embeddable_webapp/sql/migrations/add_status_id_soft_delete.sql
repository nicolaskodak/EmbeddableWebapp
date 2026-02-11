-- ============================================
-- Migration: Add status_id for Soft Delete
-- Description: Add status_id FK to all tables for unified soft delete
-- All operations are atomic - if any step fails, everything rolls back
-- ============================================

-- Explicit transaction wrapper for safety
BEGIN;

DO $$
DECLARE
  active_status_id BIGINT;
  inactive_status_id BIGINT;
BEGIN
  -- Step 1: Ensure English status values exist
  INSERT INTO tb_mgmt.status (status) VALUES ('active'), ('inactive')
  ON CONFLICT (status) DO NOTHING;

  -- Step 2: Get status IDs for later use
  SELECT id INTO active_status_id FROM tb_mgmt.status WHERE status = 'active';
  SELECT id INTO inactive_status_id FROM tb_mgmt.status WHERE status = 'inactive';

  -- Verify we got the IDs
  IF active_status_id IS NULL OR inactive_status_id IS NULL THEN
    RAISE EXCEPTION 'Failed to get active/inactive status IDs';
  END IF;

  -- Step 3: Convert stores.status TEXT to status_id BIGINT
  -- First, add the new column
  ALTER TABLE tb_mgmt.stores ADD COLUMN status_id BIGINT;

  -- Migrate existing data: map TEXT values to status_id
  UPDATE tb_mgmt.stores
  SET status_id = CASE
    WHEN status = 'active' THEN active_status_id
    WHEN status = 'inactive' THEN inactive_status_id
    ELSE active_status_id  -- Default to active for any unexpected values
  END;

  -- Make it NOT NULL after migration
  ALTER TABLE tb_mgmt.stores ALTER COLUMN status_id SET NOT NULL;

  -- Add FK constraint
  ALTER TABLE tb_mgmt.stores
    ADD CONSTRAINT fk_stores_status
    FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Drop old TEXT column
  -- ALTER TABLE tb_mgmt.stores DROP COLUMN status;

  -- Step 4: Add status_id to all other tables (16 tables)
  -- We add the column, populate it, then make it NOT NULL and add FK

  -- Product-related tables
  ALTER TABLE tb_mgmt.products ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.products SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.products ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.products ADD CONSTRAINT fk_products_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.product_categories ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.product_categories SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.product_categories ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.product_categories ADD CONSTRAINT fk_product_categories_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.product_bom ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.product_bom SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.product_bom ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.product_bom ADD CONSTRAINT fk_product_bom_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Ingredient-related tables
  ALTER TABLE tb_mgmt.ingredients ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.ingredients SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.ingredients ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.ingredients ADD CONSTRAINT fk_ingredients_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.semi_product_bom ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.semi_product_bom SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.semi_product_bom ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.semi_product_bom ADD CONSTRAINT fk_semi_product_bom_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Inventory tables
  ALTER TABLE tb_mgmt.erp_inventory ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.erp_inventory SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.erp_inventory ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.erp_inventory ADD CONSTRAINT fk_erp_inventory_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.inventory_details ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.inventory_details SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.inventory_details ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.inventory_details ADD CONSTRAINT fk_inventory_details_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.erp_inventory_suppliers ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.erp_inventory_suppliers SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.erp_inventory_suppliers ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.erp_inventory_suppliers ADD CONSTRAINT fk_erp_inventory_suppliers_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Supplier and customer tables
  ALTER TABLE tb_mgmt.suppliers ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.suppliers SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.suppliers ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.suppliers ADD CONSTRAINT fk_suppliers_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.erp_customers ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.erp_customers SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.erp_customers ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.erp_customers ADD CONSTRAINT fk_erp_customers_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Unit tables
  ALTER TABLE tb_mgmt.units ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.units SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.units ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.units ADD CONSTRAINT fk_units_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.unit_conversions ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.unit_conversions SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.unit_conversions ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.unit_conversions ADD CONSTRAINT fk_unit_conversions_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- POS tables
  ALTER TABLE tb_mgmt.pos_stores ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.pos_stores SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.pos_stores ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.pos_stores ADD CONSTRAINT fk_pos_stores_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.pos_item_mapping ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.pos_item_mapping SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.pos_item_mapping ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.pos_item_mapping ADD CONSTRAINT fk_pos_item_mapping_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.pos_option_group ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.pos_option_group SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.pos_option_group ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.pos_option_group ADD CONSTRAINT fk_pos_option_group_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  ALTER TABLE tb_mgmt.pos_option_value ADD COLUMN status_id BIGINT;
  UPDATE tb_mgmt.pos_option_value SET status_id = active_status_id;
  ALTER TABLE tb_mgmt.pos_option_value ALTER COLUMN status_id SET NOT NULL;
  ALTER TABLE tb_mgmt.pos_option_value ADD CONSTRAINT fk_pos_option_value_status FOREIGN KEY (status_id) REFERENCES tb_mgmt.status(id);

  -- Note: pos_items already has status_id, so we skip it
END $$;

-- Commit the transaction
-- If we got here, everything succeeded
COMMIT;

-- If any error occurred above, the entire migration will be rolled back
-- You can verify success by checking: SELECT table_name FROM information_schema.columns WHERE table_schema = 'tb_mgmt' AND column_name = 'status_id';
