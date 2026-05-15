-- Remove legacy Wiki Overseer / agent_decisions stack (replaced by editorial pipeline v2 + human_review_queue).
DROP TABLE IF EXISTS agent_audit_log CASCADE;
DROP TABLE IF EXISTS agent_decisions CASCADE;
DROP TABLE IF EXISTS agent_sessions CASCADE;
