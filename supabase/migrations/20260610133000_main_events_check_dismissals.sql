ALTER TABLE main_events_check_cache
  ADD COLUMN IF NOT EXISTS dismissed_dates jsonb NOT NULL DEFAULT '{"misplaced":[],"missing":[],"extra":[]}'::jsonb;
