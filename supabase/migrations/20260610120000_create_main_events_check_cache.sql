CREATE TABLE IF NOT EXISTS main_events_check_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storyline_leaf text NOT NULL,
  normalized_leaf text NOT NULL,
  gemini_model text NOT NULL,
  cache_version text NOT NULL,
  notes text,
  canonical_dates jsonb NOT NULL,
  skipped_canonical jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_main_events_check_cache_normalized_leaf
  ON main_events_check_cache (normalized_leaf);
