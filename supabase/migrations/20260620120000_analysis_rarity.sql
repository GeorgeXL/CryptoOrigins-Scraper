-- One collector rarity label per locked calendar day.
ALTER TABLE historical_news_analyses
  ADD COLUMN IF NOT EXISTS rarity text;

CREATE INDEX IF NOT EXISTS idx_historical_news_rarity
  ON historical_news_analyses (rarity);
