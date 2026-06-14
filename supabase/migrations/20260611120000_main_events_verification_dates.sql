ALTER TABLE main_events_check_cache
  ADD COLUMN IF NOT EXISTS verification_dates jsonb NOT NULL DEFAULT '{"matched":[],"pending":[]}'::jsonb;
