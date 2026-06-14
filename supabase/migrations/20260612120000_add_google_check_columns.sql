-- Persist homepage Google check verdicts on historical_news_analyses
ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS google_check_happened TEXT,
ADD COLUMN IF NOT EXISTS google_check_checked_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_historical_news_google_check_happened
ON historical_news_analyses(google_check_happened);
