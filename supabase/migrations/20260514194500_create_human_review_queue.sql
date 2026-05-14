-- Human review queue for editorial pipeline v2

CREATE TABLE IF NOT EXISTS human_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES pipeline_steps(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 50,
  event_date DATE,
  reviewer TEXT,
  review_notes TEXT,
  package JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_human_review_queue_run_id ON human_review_queue(run_id);
CREATE INDEX IF NOT EXISTS idx_human_review_queue_status ON human_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_human_review_queue_priority ON human_review_queue(priority);
CREATE INDEX IF NOT EXISTS idx_human_review_queue_event_date ON human_review_queue(event_date);
