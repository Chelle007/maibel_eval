-- Remove context column from test_cases (no longer used by API).
ALTER TABLE test_cases DROP COLUMN IF EXISTS context;
