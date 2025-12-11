-- Add is_orphan column to historical_news_analyses table
-- This marks entries where neither Perplexity nor Gemini found relevant articles during battle

ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS is_orphan BOOLEAN DEFAULT false;

-- Create index for filtering orphans
CREATE INDEX IF NOT EXISTS idx_historical_news_is_orphan ON historical_news_analyses(is_orphan);







