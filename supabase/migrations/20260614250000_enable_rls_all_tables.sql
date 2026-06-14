-- Enable RLS on every public app table (skip tables not present in this project DB).
--
-- Browser (anon key): only tables with explicit policies stay reachable via PostgREST.
-- Express server (DATABASE_URL / postgres role): bypasses RLS unless FORCE RLS is set.

CREATE OR REPLACE FUNCTION public.__apply_rls_policies_if_table_exists(
  qualified_name text,
  policy_sql text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  stmt text;
BEGIN
  IF to_regclass(qualified_name) IS NULL THEN
    RAISE NOTICE 'Skipping RLS for missing table %', qualified_name;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', qualified_name);

  FOREACH stmt IN ARRAY policy_sql LOOP
    EXECUTE stmt;
  END LOOP;
END;
$$;

-- historical_news_analyses (client read/write)
SELECT public.__apply_rls_policies_if_table_exists(
  'public.historical_news_analyses',
  ARRAY[
    'DROP POLICY IF EXISTS "Allow anon read historical_news_analyses" ON public.historical_news_analyses',
    'CREATE POLICY "Allow anon read historical_news_analyses" ON public.historical_news_analyses FOR SELECT TO anon, authenticated USING (true)',
    'DROP POLICY IF EXISTS "Allow anon insert historical_news_analyses" ON public.historical_news_analyses',
    'CREATE POLICY "Allow anon insert historical_news_analyses" ON public.historical_news_analyses FOR INSERT TO anon, authenticated WITH CHECK (true)',
    'DROP POLICY IF EXISTS "Allow anon update historical_news_analyses" ON public.historical_news_analyses',
    'CREATE POLICY "Allow anon update historical_news_analyses" ON public.historical_news_analyses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)'
  ]
);

-- manual_news_entries (client read-only)
SELECT public.__apply_rls_policies_if_table_exists(
  'public.manual_news_entries',
  ARRAY[
    'DROP POLICY IF EXISTS "Allow anon read manual_news_entries" ON public.manual_news_entries',
    'CREATE POLICY "Allow anon read manual_news_entries" ON public.manual_news_entries FOR SELECT TO anon, authenticated USING (true)'
  ]
);

-- main_events_check_cache (client read + patch)
SELECT public.__apply_rls_policies_if_table_exists(
  'public.main_events_check_cache',
  ARRAY[
    'DROP POLICY IF EXISTS "Allow anon read main_events_check_cache" ON public.main_events_check_cache',
    'CREATE POLICY "Allow anon read main_events_check_cache" ON public.main_events_check_cache FOR SELECT TO anon, authenticated USING (true)',
    'DROP POLICY IF EXISTS "Allow anon insert main_events_check_cache" ON public.main_events_check_cache',
    'CREATE POLICY "Allow anon insert main_events_check_cache" ON public.main_events_check_cache FOR INSERT TO anon, authenticated WITH CHECK (true)',
    'DROP POLICY IF EXISTS "Allow anon update main_events_check_cache" ON public.main_events_check_cache',
    'CREATE POLICY "Allow anon update main_events_check_cache" ON public.main_events_check_cache FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)'
  ]
);

-- main_events_cross_leaf_assignments (client read/write)
SELECT public.__apply_rls_policies_if_table_exists(
  'public.main_events_cross_leaf_assignments',
  ARRAY[
    'DROP POLICY IF EXISTS "Allow anon read main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments',
    'CREATE POLICY "Allow anon read main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments FOR SELECT TO anon, authenticated USING (true)',
    'DROP POLICY IF EXISTS "Allow anon insert main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments',
    'CREATE POLICY "Allow anon insert main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments FOR INSERT TO anon, authenticated WITH CHECK (true)',
    'DROP POLICY IF EXISTS "Allow anon update main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments',
    'CREATE POLICY "Allow anon update main_events_cross_leaf_assignments" ON public.main_events_cross_leaf_assignments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)'
  ]
);

-- isolated_lab_samples (dev/lab page)
SELECT public.__apply_rls_policies_if_table_exists(
  'public.isolated_lab_samples',
  ARRAY[
    'DROP POLICY IF EXISTS "Allow anon read isolated_lab_samples" ON public.isolated_lab_samples',
    'CREATE POLICY "Allow anon read isolated_lab_samples" ON public.isolated_lab_samples FOR SELECT TO anon, authenticated USING (true)',
    'DROP POLICY IF EXISTS "Allow anon insert isolated_lab_samples" ON public.isolated_lab_samples',
    'CREATE POLICY "Allow anon insert isolated_lab_samples" ON public.isolated_lab_samples FOR INSERT TO anon, authenticated WITH CHECK (true)'
  ]
);

-- Server-only tables: RLS on, no anon/authenticated policies.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pipeline_runs',
    'pipeline_steps',
    'pipeline_handoffs',
    'pipeline_evidence',
    'pipeline_confidence_history',
    'canonical_milestones',
    'human_review_queue'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'Skipping server-only RLS for missing table public.%', t;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION public.__apply_rls_policies_if_table_exists(text, text[]);
