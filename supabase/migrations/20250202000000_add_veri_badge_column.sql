-- Add veri_badge column to historical_news_analyses table
-- This categorizes entries as: 'Manual', 'Orphan', 'Verified', or 'Not Available'
-- Priority: Manual > Orphan > Verified > Not Available

ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS veri_badge TEXT;

-- Create index for filtering by badge
CREATE INDEX IF NOT EXISTS idx_historical_news_veri_badge ON historical_news_analyses(veri_badge);

-- Function to calculate veri_badge value
CREATE OR REPLACE FUNCTION calculate_veri_badge(
  p_is_manual_override BOOLEAN,
  p_is_orphan BOOLEAN,
  p_gemini_approved BOOLEAN,
  p_perplexity_approved BOOLEAN
) RETURNS TEXT AS $$
BEGIN
  -- Priority order: Manual > Orphan > Verified > Not Available
  IF p_is_manual_override = true THEN
    RETURN 'Manual';
  ELSIF p_is_orphan = true THEN
    RETURN 'Orphan';
  ELSIF p_gemini_approved = true AND p_perplexity_approved = true THEN
    RETURN 'Verified';
  ELSE
    RETURN 'Not Available';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger function to auto-update veri_badge
CREATE OR REPLACE FUNCTION update_veri_badge()
RETURNS TRIGGER AS $$
BEGIN
  NEW.veri_badge := calculate_veri_badge(
    NEW.is_manual_override,
    NEW.is_orphan,
    NEW.gemini_approved,
    NEW.perplexity_approved
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update veri_badge on INSERT or UPDATE
DROP TRIGGER IF EXISTS trigger_update_veri_badge ON historical_news_analyses;
CREATE TRIGGER trigger_update_veri_badge
BEFORE INSERT OR UPDATE ON historical_news_analyses
FOR EACH ROW
EXECUTE FUNCTION update_veri_badge();

-- Backfill existing data
UPDATE historical_news_analyses
SET veri_badge = calculate_veri_badge(
  is_manual_override,
  is_orphan,
  gemini_approved,
  perplexity_approved
)
WHERE veri_badge IS NULL;

