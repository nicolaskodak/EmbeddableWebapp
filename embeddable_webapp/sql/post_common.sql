-- 觸發器：每張表 BEFORE UPDATE 自動 set updated_at
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'tb_mgmt'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON tb_mgmt.%I
       FOR EACH ROW
       EXECUTE FUNCTION tb_mgmt.set_updated_at();',
      r.tablename,
      r.tablename
    );
  END LOOP;
END $$;