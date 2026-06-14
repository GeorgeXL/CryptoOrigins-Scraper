-- Resolve dates that appear on multiple storyline leaves' Gemini main-event lists.
CREATE TABLE IF NOT EXISTS main_events_cross_leaf_assignments (
  date date PRIMARY KEY,
  owner_leaf text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_main_events_cross_leaf_owner
  ON main_events_cross_leaf_assignments (owner_leaf);

COMMENT ON TABLE main_events_cross_leaf_assignments IS
  'Operator-chosen owner leaf when the same date is proposed on multiple Gemini main-event lists';

ALTER TABLE public.main_events_cross_leaf_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments;
CREATE POLICY "Allow anon read main_events_cross_leaf_assignments"
  ON public.main_events_cross_leaf_assignments
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow anon insert main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments;
CREATE POLICY "Allow anon insert main_events_cross_leaf_assignments"
  ON public.main_events_cross_leaf_assignments
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments;
CREATE POLICY "Allow anon update main_events_cross_leaf_assignments"
  ON public.main_events_cross_leaf_assignments
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
