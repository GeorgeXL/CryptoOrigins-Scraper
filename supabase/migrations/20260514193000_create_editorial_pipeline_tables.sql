-- Editorial Pipeline v2 tables
-- Purpose: Introduce triage-first orchestration metadata while preserving existing agent flows.

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  requested_by TEXT DEFAULT 'admin-ui',
  stats JSONB,
  config JSONB
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_date_range ON pipeline_runs(date_from, date_to);

CREATE TABLE IF NOT EXISTS pipeline_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  confidence NUMERIC(5,2),
  rejection_reason TEXT,
  suggested_action TEXT,
  return_to TEXT,
  input JSONB,
  output JSONB,
  evidence JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_steps_run_step ON pipeline_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run_id ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_agent_name ON pipeline_steps(agent_name);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_status ON pipeline_steps(status);

CREATE TABLE IF NOT EXISTS pipeline_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_handoffs_run_id ON pipeline_handoffs(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_handoffs_from_agent ON pipeline_handoffs(from_agent);
CREATE INDEX IF NOT EXISTS idx_pipeline_handoffs_to_agent ON pipeline_handoffs(to_agent);
