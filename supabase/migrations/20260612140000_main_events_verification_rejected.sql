-- Extend verification_dates JSON with rejected[] for manual accept/reject workflow.
-- Existing rows keep matched/pending; rejected defaults to [] when read in application code.

COMMENT ON COLUMN main_events_check_cache.verification_dates IS
  'Per-date manual review: matched=accepted, rejected=rejected, pending=not yet reviewed or restored';
