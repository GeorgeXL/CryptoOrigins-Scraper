ALTER TABLE historical_news_analyses
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_historical_news_is_locked
  ON historical_news_analyses (is_locked)
  WHERE is_locked = true;
