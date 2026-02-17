-- Add context column to test_cases if it doesn't exist (e.g. DB created from an older schema)
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS context TEXT;
