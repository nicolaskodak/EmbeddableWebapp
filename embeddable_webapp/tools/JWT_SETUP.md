-- 1) Enable RLS
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- 2) Grant only the operations you intend to allow
-- Example: allow authenticated users to read; restrict writes until policies are defined
GRANT SELECT ON public.items TO authenticated;

-- 3) Define a safe read policy (example: everyone authenticated can read)
CREATE POLICY "items_read_authenticated"
  ON public.items
  FOR SELECT
  TO authenticated
  USING (true);

-- Example ownership model (if items has a user_id column):
-- Uncomment and adapt if you want per-user isolation for writes.
-- GRANT INSERT, UPDATE, DELETE ON public.items TO authenticated;
-- CREATE POLICY "items_insert_own"
--   ON public.items
--   FOR INSERT
--   TO authenticated
--   WITH CHECK ((SELECT auth.uid()) = user_id);
-- CREATE POLICY "items_update_own"
--   ON public.items
--   FOR UPDATE
--   TO authenticated
--   USING ((SELECT auth.uid()) = user_id)
--   WITH CHECK ((SELECT auth.uid()) = user_id);
-- CREATE POLICY "items_delete_own"
--   ON public.items
--   FOR DELETE
--   TO authenticated
--   USING ((SELECT auth.uid()) = user_id);

-- 4) Helpful indexes for RLS performance (if using user_id or tenant_id)
-- CREATE INDEX IF NOT EXISTS idx_items_user_id ON public.items(user_id);