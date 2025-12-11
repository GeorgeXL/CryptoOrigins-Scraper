-- Migration: Create Agent Tables
-- Description: Create tables for the Autonomous Curator Agent system
-- Date: 2025-11-29

-- Add verification fields to historical_news_analyses
ALTER TABLE historical_news_analyses 
ADD COLUMN IF NOT EXISTS gemini_confidence NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS gemini_sources JSONB,
ADD COLUMN IF NOT EXISTS gemini_importance INTEGER,
ADD COLUMN IF NOT EXISTS perplexity_confidence_score NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS perplexity_sources JSONB,
ADD COLUMN IF NOT EXISTS perplexity_importance INTEGER,
ADD COLUMN IF NOT EXISTS agreement_score NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS verification_status TEXT,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS agent_created BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS agent_session TEXT;

-- Create agent_sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  current_pass INTEGER NOT NULL DEFAULT 1,
  max_passes INTEGER NOT NULL DEFAULT 10,
  issues_fixed INTEGER NOT NULL DEFAULT 0,
  issues_flagged INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(10,4) DEFAULT 0,
  quality_score NUMERIC(5,2),
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  config JSONB,
  stats JSONB
);

-- Create indexes for agent_sessions
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started_at ON agent_sessions(started_at);

-- Create agent_decisions table
CREATE TABLE IF NOT EXISTS agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  pass_number INTEGER NOT NULL,
  module TEXT NOT NULL,
  type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  confidence NUMERIC(5,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  before_state JSONB,
  after_state JSONB,
  reasoning TEXT,
  sources JSONB,
  cost NUMERIC(10,4),
  approved_by TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for agent_decisions
CREATE INDEX IF NOT EXISTS idx_agent_decisions_session ON agent_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_module ON agent_decisions(module);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_status ON agent_decisions(status);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_confidence ON agent_decisions(confidence);

-- Create agent_audit_log table
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  pass_number INTEGER NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_value JSONB,
  after_value JSONB,
  reasoning TEXT,
  confidence NUMERIC(5,2),
  cost NUMERIC(10,4),
  duration_ms INTEGER,
  approved_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for agent_audit_log
CREATE INDEX IF NOT EXISTS idx_agent_audit_session ON agent_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_module ON agent_audit_log(module);
CREATE INDEX IF NOT EXISTS idx_agent_audit_action ON agent_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON agent_audit_log(created_at);

-- Add comments for documentation
COMMENT ON TABLE agent_sessions IS 'Tracks each autonomous agent run session';
COMMENT ON TABLE agent_decisions IS 'Stores all decisions made by the agent for review';
COMMENT ON TABLE agent_audit_log IS 'Comprehensive audit trail of all agent actions';

COMMENT ON COLUMN historical_news_analyses.gemini_confidence IS 'Gemini verification confidence score 0-100';
COMMENT ON COLUMN historical_news_analyses.perplexity_confidence_score IS 'Perplexity verification confidence score 0-100';
COMMENT ON COLUMN historical_news_analyses.agreement_score IS 'Agreement between Gemini and Perplexity 0-100';
COMMENT ON COLUMN historical_news_analyses.verification_status IS 'Status: verified, flagged, rejected, pending';
COMMENT ON COLUMN historical_news_analyses.agent_created IS 'Was this news entry created by the autonomous agent?';
COMMENT ON COLUMN historical_news_analyses.agent_session IS 'Session ID if created/modified by agent';







