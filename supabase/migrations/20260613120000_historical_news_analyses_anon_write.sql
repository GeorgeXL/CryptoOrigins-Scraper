-- Allow client-side admin writes (manual entry, etc.) via Supabase anon key.
-- Reads already worked; inserts/updates were blocked by RLS (PGRST116 / 42501).

ALTER TABLE public.historical_news_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read historical_news_analyses" ON public.historical_news_analyses;
CREATE POLICY "Allow anon read historical_news_analyses"
  ON public.historical_news_analyses
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow anon insert historical_news_analyses" ON public.historical_news_analyses;
CREATE POLICY "Allow anon insert historical_news_analyses"
  ON public.historical_news_analyses
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update historical_news_analyses" ON public.historical_news_analyses;
CREATE POLICY "Allow anon update historical_news_analyses"
  ON public.historical_news_analyses
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
