-- Add ready_for_tagging and double-check columns to historical_news_analyses table
ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS ready_for_tagging BOOLEAN,
ADD COLUMN IF NOT EXISTS double_check_reasoning TEXT,
ADD COLUMN IF NOT EXISTS double_checked_at TIMESTAMP;

-- Create index for faster queries on ready_for_tagging
CREATE INDEX IF NOT EXISTS idx_historical_news_ready_for_tagging 
ON historical_news_analyses(ready_for_tagging);

-- Add comment
COMMENT ON COLUMN historical_news_analyses.ready_for_tagging IS 'Passed double-check and ready for tagging (null = not checked, true = passed, false = failed)';
COMMENT ON COLUMN historical_news_analyses.double_check_reasoning IS 'Reasoning from double-check process';
COMMENT ON COLUMN historical_news_analyses.double_checked_at IS 'When double-check was performed';

