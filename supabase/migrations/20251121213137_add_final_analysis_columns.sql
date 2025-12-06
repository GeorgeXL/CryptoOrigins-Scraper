-- Add final analysis verification columns to historical_news_analyses table
ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS gemini_approved BOOLEAN,
ADD COLUMN IF NOT EXISTS perplexity_approved BOOLEAN,
ADD COLUMN IF NOT EXISTS final_analysis_checked_at TIMESTAMP;

-- Add index for faster queries on final analysis status
CREATE INDEX IF NOT EXISTS idx_historical_news_final_analysis_checked 
ON historical_news_analyses(final_analysis_checked_at);















