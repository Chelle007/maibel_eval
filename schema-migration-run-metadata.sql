-- Run metadata on test_sessions (TASK-022 / Phase 6).
-- Structured JSON capturing environment, code source, models, sample size, etc.
ALTER TABLE test_sessions
  ADD COLUMN IF NOT EXISTS run_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
