-- Drop DB columns on historical_news_analyses that are not in application schema (orphan / legacy agent fields).

DROP TRIGGER IF EXISTS trigger_update_veri_badge ON historical_news_analyses;
DROP FUNCTION IF EXISTS update_veri_badge();
DROP FUNCTION IF EXISTS calculate_veri_badge(boolean, text);
DROP FUNCTION IF EXISTS calculate_veri_badge(boolean, boolean, boolean, boolean);

DROP INDEX IF EXISTS idx_historical_news_veri_badge;

ALTER TABLE historical_news_analyses
  DROP COLUMN IF EXISTS tag_names,
  DROP COLUMN IF EXISTS gemini_confidence,
  DROP COLUMN IF EXISTS gemini_sources,
  DROP COLUMN IF EXISTS gemini_importance,
  DROP COLUMN IF EXISTS perplexity_confidence_score,
  DROP COLUMN IF EXISTS perplexity_sources,
  DROP COLUMN IF EXISTS perplexity_importance,
  DROP COLUMN IF EXISTS agreement_score,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS agent_session,
  DROP COLUMN IF EXISTS double_checked_at,
  DROP COLUMN IF EXISTS agent_created,
  DROP COLUMN IF EXISTS veri_badge;
