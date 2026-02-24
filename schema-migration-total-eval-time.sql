-- Add total evaluation time (seconds) to test_sessions for existing databases.
-- New installs use schema.sql which already includes this column.

ALTER TABLE test_sessions
  ADD COLUMN IF NOT EXISTS total_eval_time_seconds DOUBLE PRECISION;
