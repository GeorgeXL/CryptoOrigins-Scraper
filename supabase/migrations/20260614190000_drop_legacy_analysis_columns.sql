-- Drop legacy analysis columns from historical_news_analyses (editorial v2 surface).

DROP INDEX IF EXISTS idx_historical_news_confidence;
DROP INDEX IF EXISTS idx_historical_news_sentiment;
DROP INDEX IF EXISTS idx_historical_news_fact_check_verdict;

ALTER TABLE historical_news_analyses
  DROP COLUMN IF EXISTS confidence_score,
  DROP COLUMN IF EXISTS sentiment_score,
  DROP COLUMN IF EXISTS sentiment_label,
  DROP COLUMN IF EXISTS ai_provider,
  DROP COLUMN IF EXISTS fact_check_verdict,
  DROP COLUMN IF EXISTS fact_check_confidence,
  DROP COLUMN IF EXISTS fact_check_reasoning,
  DROP COLUMN IF EXISTS fact_checked_at,
  DROP COLUMN IF EXISTS perplexity_verdict,
  DROP COLUMN IF EXISTS perplexity_confidence,
  DROP COLUMN IF EXISTS perplexity_reasoning,
  DROP COLUMN IF EXISTS perplexity_correct_date,
  DROP COLUMN IF EXISTS perplexity_correct_date_text,
  DROP COLUMN IF EXISTS perplexity_citations,
  DROP COLUMN IF EXISTS perplexity_checked_at,
  DROP COLUMN IF EXISTS re_verified,
  DROP COLUMN IF EXISTS re_verified_at,
  DROP COLUMN IF EXISTS re_verification_date,
  DROP COLUMN IF EXISTS re_verification_summary,
  DROP COLUMN IF EXISTS re_verification_tier,
  DROP COLUMN IF EXISTS re_verification_articles,
  DROP COLUMN IF EXISTS re_verification_reasoning,
  DROP COLUMN IF EXISTS re_verification_status,
  DROP COLUMN IF EXISTS re_verification_winner,
  DROP COLUMN IF EXISTS final_analysis_checked_at,
  DROP COLUMN IF EXISTS gemini_approved,
  DROP COLUMN IF EXISTS perplexity_approved,
  DROP COLUMN IF EXISTS is_orphan,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS duplicate_article_ids,
  DROP COLUMN IF EXISTS total_articles_fetched,
  DROP COLUMN IF EXISTS unique_articles_analyzed,
  DROP COLUMN IF EXISTS flag_reason;

-- veri_badge trigger referenced dropped columns; recompute from remaining signals.
CREATE OR REPLACE FUNCTION calculate_veri_badge(
  p_is_manual_override BOOLEAN,
  p_google_check_happened TEXT
) RETURNS TEXT AS $$
BEGIN
  IF p_is_manual_override = true THEN
    RETURN 'Manual';
  ELSIF p_google_check_happened = 'yes' THEN
    RETURN 'Verified';
  ELSE
    RETURN 'Not Available';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION update_veri_badge()
RETURNS TRIGGER AS $$
BEGIN
  NEW.veri_badge := calculate_veri_badge(
    NEW.is_manual_override,
    NEW.google_check_happened
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_veri_badge ON historical_news_analyses;
CREATE TRIGGER trigger_update_veri_badge
BEFORE INSERT OR UPDATE ON historical_news_analyses
FOR EACH ROW
EXECUTE FUNCTION update_veri_badge();

UPDATE historical_news_analyses
SET veri_badge = calculate_veri_badge(is_manual_override, google_check_happened);
