-- Add remaining v2 entities: evidence, confidence history, canonical milestones

CREATE TABLE IF NOT EXISTS pipeline_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES pipeline_steps(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  title TEXT,
  published_at TIMESTAMP,
  credibility_score NUMERIC(5,2),
  claim TEXT,
  snippet TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_evidence_run_id ON pipeline_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_evidence_step_id ON pipeline_evidence(step_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_evidence_source_type ON pipeline_evidence(source_type);

CREATE TABLE IF NOT EXISTS pipeline_confidence_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES pipeline_steps(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_conf_hist_run_id ON pipeline_confidence_history(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_conf_hist_step_id ON pipeline_confidence_history(step_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_conf_hist_agent_name ON pipeline_confidence_history(agent_name);

CREATE TABLE IF NOT EXISTS canonical_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  expected_date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'bitcoin-history',
  priority TEXT NOT NULL DEFAULT 'high',
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_milestones_expected_date ON canonical_milestones(expected_date);
CREATE INDEX IF NOT EXISTS idx_canonical_milestones_priority ON canonical_milestones(priority);

INSERT INTO canonical_milestones (slug, label, expected_date, priority, description)
VALUES
  ('genesis-block', 'Genesis Block', '2009-01-03', 'critical', 'Bitcoin genesis block mined by Satoshi Nakamoto'),
  ('bitcoin-pizza-day', 'Bitcoin Pizza Day', '2010-05-22', 'critical', 'First known real-world Bitcoin purchase'),
  ('first-halving', 'First Halving', '2012-11-28', 'critical', 'Block subsidy reduced from 50 BTC to 25 BTC'),
  ('second-halving', 'Second Halving', '2016-07-09', 'critical', 'Block subsidy reduced from 25 BTC to 12.5 BTC'),
  ('third-halving', 'Third Halving', '2020-05-11', 'critical', 'Block subsidy reduced from 12.5 BTC to 6.25 BTC'),
  ('fourth-halving', 'Fourth Halving', '2024-04-20', 'critical', 'Block subsidy reduced from 6.25 BTC to 3.125 BTC'),
  ('ftx-collapse', 'FTX Collapse', '2022-11-11', 'high', 'FTX files for bankruptcy after liquidity crisis'),
  ('us-spot-etf-approval', 'US Spot Bitcoin ETF Approval', '2024-01-10', 'critical', 'US SEC approves first spot Bitcoin ETFs')
ON CONFLICT (slug) DO NOTHING;
