-- Add new column for individual tag names (without categories)
-- This will be used by Tags Browser for frontend-only grouping
ALTER TABLE historical_news_analyses 
ADD COLUMN IF NOT EXISTS tag_names text[];

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_historical_news_tag_names ON historical_news_analyses USING GIN (tag_names);

-- Populate the new column from existing tags column
-- Extract just the tag names from the JSONB tags array
UPDATE historical_news_analyses
SET tag_names = (
  SELECT ARRAY_AGG(tag->>'name')
  FROM jsonb_array_elements(tags) AS tag
  WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
)
WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array';

-- Add comment
COMMENT ON COLUMN historical_news_analyses.tag_names IS 'Array of tag names without categories, used for frontend-only grouping in Tags Browser';


