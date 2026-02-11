-- ============================================
-- Migration: Remove status TEXT column from stores
-- Description: Drop the old status TEXT column now that status_id is in use
-- Prerequisite: add_status_id_soft_delete.sql must be run first
-- ============================================

-- IMPORTANT: Verify that all stores records have valid status_id before running this migration
-- Run this query first to check:
-- SELECT COUNT(*) FROM tb_mgmt.stores WHERE status_id IS NULL;
-- Expected result: 0

-- Explicit transaction wrapper for safety
BEGIN;

DO $$
BEGIN
  -- Safety check: Ensure all stores have status_id set
  IF EXISTS (
    SELECT 1 FROM tb_mgmt.stores WHERE status_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot drop status column: some stores have NULL status_id. Run add_status_id_soft_delete.sql first.';
  END IF;

  -- Drop the old TEXT status column
  ALTER TABLE tb_mgmt.stores DROP COLUMN IF EXISTS status;

  RAISE NOTICE 'Successfully dropped stores.status column';
END $$;

-- Commit the transaction
COMMIT;

-- If any error occurred above, the entire migration will be rolled back

-- ============================================
-- Rollback Instructions (if needed)
-- ============================================
-- To rollback this migration, you would need to:
-- 1. Re-add the status column as TEXT
-- 2. Populate it from status_id by joining with tb_mgmt.status
--
-- Example rollback (DO NOT RUN unless you need to rollback):
-- BEGIN;
-- ALTER TABLE tb_mgmt.stores ADD COLUMN status TEXT;
-- UPDATE tb_mgmt.stores s
-- SET status = st.status
-- FROM tb_mgmt.status st
-- WHERE s.status_id = st.id;
-- ALTER TABLE tb_mgmt.stores ALTER COLUMN status SET NOT NULL;
-- COMMIT;
