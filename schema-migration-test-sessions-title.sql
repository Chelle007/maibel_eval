-- Add title column to test_sessions (output by summarizer model).
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS title TEXT;
