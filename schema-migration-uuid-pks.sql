-- Migration: Add stable UUID PKs for test_sessions and test_cases.
-- Display IDs (test_session_id, test_case_id) become UNIQUE NOT NULL and are editable.
-- Run this on an existing database that has the current TEXT PKs.

-- =============================================================================
-- 1. test_sessions: add session_id as new PK
-- =============================================================================

ALTER TABLE test_sessions
  ADD COLUMN IF NOT EXISTS session_id UUID DEFAULT gen_random_uuid() NOT NULL;

UPDATE test_sessions SET session_id = gen_random_uuid() WHERE session_id IS NULL;

ALTER TABLE test_sessions
  ALTER COLUMN session_id SET DEFAULT gen_random_uuid();

-- Unique on session_id so eval_results can reference it (we cannot drop test_session_id PK yet)
CREATE UNIQUE INDEX IF NOT EXISTS test_sessions_session_id_key ON test_sessions(session_id);

-- eval_results: add new FK column and backfill
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES test_sessions(session_id) ON DELETE CASCADE;

UPDATE eval_results er
SET session_id = ts.session_id
FROM test_sessions ts
WHERE er.test_session_id = ts.test_session_id;

ALTER TABLE eval_results ALTER COLUMN session_id SET NOT NULL;

-- Drop the dependent foreign key first (name may vary by environment)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND NOT a.attisdropped
    WHERE t.relname = 'eval_results'
      AND c.contype = 'f'
      AND c.confrelid = (SELECT oid FROM pg_class WHERE relname = 'test_sessions')
      AND a.attname = 'test_session_id'
  ) LOOP
    EXECUTE format('ALTER TABLE eval_results DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE eval_results DROP COLUMN IF EXISTS test_session_id;

DROP INDEX IF EXISTS idx_eval_results_test_session_id;
CREATE INDEX idx_eval_results_session_id ON eval_results(session_id);

-- Now drop the old PK and add the new one
ALTER TABLE test_sessions DROP CONSTRAINT IF EXISTS test_sessions_pkey;
ALTER TABLE test_sessions ADD PRIMARY KEY (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS test_sessions_test_session_id_key ON test_sessions(test_session_id);
-- Leave test_sessions_session_id_key in place; eval_results_session_id_fkey depends on it.

-- =============================================================================
-- 2. test_cases: add id as new PK
-- =============================================================================

ALTER TABLE test_cases
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid() NOT NULL;

UPDATE test_cases SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE test_cases
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Make id the PK and test_case_id UNIQUE (must do before eval_results can reference test_cases(id))
ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_pkey;
ALTER TABLE test_cases ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS test_cases_test_case_id_key ON test_cases(test_case_id);

-- eval_results: add new FK column and backfill (join by current test_case_id on test_cases)
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS test_case_uuid UUID REFERENCES test_cases(id) ON DELETE CASCADE;

UPDATE eval_results er
SET test_case_uuid = tc.id
FROM test_cases tc
WHERE er.test_case_id = tc.test_case_id;

ALTER TABLE eval_results ALTER COLUMN test_case_uuid SET NOT NULL;

-- Drop old FK and column test_case_id from eval_results
ALTER TABLE eval_results DROP CONSTRAINT IF EXISTS eval_results_test_case_id_fkey;
ALTER TABLE eval_results DROP COLUMN IF EXISTS test_case_id;

DROP INDEX IF EXISTS idx_eval_results_test_case_id;
CREATE INDEX idx_eval_results_test_case_uuid ON eval_results(test_case_uuid);
