-- Migration: Recreate test_cases, test_sessions, and eval_results with UUID PKs.
-- Strategy: create new tables → copy data → drop old tables → rename new tables → restore triggers/indexes/RLS.
-- Run on an existing database that has the current TEXT PKs (test_case_id, test_session_id).

-- Ensure helper exists (same as main schema)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. Create new tables (target schema with UUID PKs)
-- =============================================================================

CREATE TABLE test_cases_new (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id       TEXT NOT NULL UNIQUE,
  title              TEXT,
  category_id        UUID REFERENCES categories(category_id) ON DELETE SET NULL,
  type               TEXT NOT NULL DEFAULT 'single_turn' CHECK (type IN ('single_turn', 'multi_turn')),
  input_message      TEXT NOT NULL,
  img_url            TEXT,
  turns              JSONB,
  expected_state     TEXT NOT NULL,
  expected_behavior  TEXT NOT NULL,
  forbidden          TEXT,
  is_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS session_short_id_seq_new START 1;

CREATE TABLE test_sessions_new (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id    TEXT NOT NULL UNIQUE DEFAULT ('ES' || LPAD(nextval('session_short_id_seq_new')::text, 3, '0')),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title              TEXT,
  total_cost_usd     DOUBLE PRECISION,
  total_eval_time_seconds DOUBLE PRECISION,
  summary            TEXT,
  manually_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eval_results_new (
  eval_result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES test_sessions_new(session_id) ON DELETE CASCADE,
  test_case_uuid     UUID NOT NULL REFERENCES test_cases_new(id) ON DELETE CASCADE,
  evren_responses    JSONB NOT NULL DEFAULT '[]',
  success            BOOLEAN NOT NULL,
  score              DOUBLE PRECISION NOT NULL,
  reason             TEXT,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  total_tokens       INTEGER,
  cost_usd           DOUBLE PRECISION,
  manually_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. Migrate data (old → new)
-- =============================================================================

-- test_cases: generate new id, keep test_case_id and all other columns
INSERT INTO test_cases_new (
  id, test_case_id, title, category_id, type, input_message, img_url,
  turns, expected_state, expected_behavior, forbidden, is_enabled, notes, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  test_case_id,
  title,
  category_id,
  COALESCE(type, 'single_turn'),
  input_message,
  img_url,
  turns,
  expected_state,
  expected_behavior,
  forbidden,
  COALESCE(is_enabled, TRUE),
  notes,
  created_at,
  updated_at
FROM test_cases;

-- test_sessions: generate new session_id, keep test_session_id and all other columns
INSERT INTO test_sessions_new (
  session_id, test_session_id, user_id, title, total_cost_usd, total_eval_time_seconds,
  summary, manually_edited, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  test_session_id,
  user_id,
  title,
  total_cost_usd,
  total_eval_time_seconds,
  summary,
  COALESCE(manually_edited, FALSE),
  created_at,
  updated_at
FROM test_sessions;

-- eval_results: map old test_session_id/test_case_id to new session_id/test_case_uuid
INSERT INTO eval_results_new (
  eval_result_id, session_id, test_case_uuid, evren_responses, success, score, reason,
  prompt_tokens, completion_tokens, total_tokens, cost_usd, manually_edited, created_at, updated_at
)
SELECT
  er.eval_result_id,
  ts_new.session_id,
  tc_new.id,
  COALESCE(er.evren_responses, '[]'::jsonb),
  er.success,
  er.score,
  er.reason,
  er.prompt_tokens,
  er.completion_tokens,
  er.total_tokens,
  er.cost_usd,
  COALESCE(er.manually_edited, FALSE),
  er.created_at,
  er.updated_at
FROM eval_results er
JOIN test_sessions ts ON er.test_session_id = ts.test_session_id
JOIN test_sessions_new ts_new ON ts.test_session_id = ts_new.test_session_id
JOIN test_cases tc ON er.test_case_id = tc.test_case_id
JOIN test_cases_new tc_new ON tc.test_case_id = tc_new.test_case_id;

-- =============================================================================
-- 3. Drop old tables (order: child first)
-- =============================================================================

DROP TABLE eval_results;
DROP TABLE test_sessions;
DROP TABLE test_cases;

-- =============================================================================
-- 4. Rename new tables (and sequence) to final names
-- =============================================================================

ALTER TABLE eval_results_new RENAME TO eval_results;
ALTER TABLE test_sessions_new RENAME TO test_sessions;
ALTER TABLE test_cases_new RENAME TO test_cases;

-- Use existing session_short_id_seq for defaults if present (old table used it)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'session_short_id_seq') THEN
    ALTER TABLE test_sessions ALTER COLUMN test_session_id SET DEFAULT ('ES' || LPAD(nextval('session_short_id_seq')::text, 3, '0'));
    DROP SEQUENCE IF EXISTS session_short_id_seq_new;
  ELSE
    ALTER SEQUENCE session_short_id_seq_new RENAME TO session_short_id_seq;
    ALTER TABLE test_sessions ALTER COLUMN test_session_id SET DEFAULT ('ES' || LPAD(nextval('session_short_id_seq')::text, 3, '0'));
  END IF;
END $$;

-- =============================================================================
-- 5. Restore indexes
-- =============================================================================

CREATE INDEX idx_test_sessions_user_id ON test_sessions(user_id);
CREATE INDEX idx_test_sessions_test_session_id ON test_sessions(test_session_id);
CREATE INDEX idx_eval_results_session_id ON eval_results(session_id);
CREATE INDEX idx_eval_results_test_case_uuid ON eval_results(test_case_uuid);
CREATE INDEX idx_test_cases_category_id ON test_cases(category_id);
CREATE INDEX idx_test_cases_test_case_id ON test_cases(test_case_id);

-- =============================================================================
-- 6. Restore triggers
-- =============================================================================

CREATE TRIGGER test_cases_updated_at
  BEFORE UPDATE ON test_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_sessions_updated_at
  BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER eval_results_updated_at
  BEFORE UPDATE ON eval_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 7. Restore RLS and policies
-- =============================================================================

ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Test cases: service_role all"
  ON test_cases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Test cases: authenticated all"
  ON test_cases FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Test sessions: service_role all"
  ON test_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Test sessions: authenticated all"
  ON test_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Eval results: service_role all"
  ON eval_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Eval results: authenticated all"
  ON eval_results FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- 8. Optional: advance session sequence past existing display IDs
-- =============================================================================

DO $$
DECLARE
  max_num BIGINT;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(REGEXP_REPLACE(test_session_id, '^ES', ''), '')::BIGINT
  ), 0) INTO max_num
  FROM test_sessions
  WHERE test_session_id ~ '^ES[0-9]+$';
  IF max_num > 0 AND EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'session_short_id_seq') THEN
    PERFORM setval('session_short_id_seq', max_num + 1);
  END IF;
END $$;
