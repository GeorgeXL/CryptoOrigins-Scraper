-- Add new column for simple tag names array (version 2)
-- This will store just tag names without categories: ["Elon Musk", "Obama", "NFT", "Bitcoin"]
ALTER TABLE historical_news_analyses 
ADD COLUMN IF NOT EXISTS tags_version2 text[];

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_historical_news_tags_version2 ON historical_news_analyses USING GIN (tags_version2);

-- Add comment
COMMENT ON COLUMN historical_news_analyses.tags_version2 IS 'Simple array of tag names without categories, used for new tagging system';

