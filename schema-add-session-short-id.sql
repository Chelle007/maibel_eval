-- Switch test_sessions PK from UUID to TEXT (ES001, ES002, ...).
-- WARNING: This drops test_sessions and eval_results and recreates them. All session and result data will be lost.

DROP TABLE IF EXISTS eval_results;
DROP TABLE IF EXISTS test_sessions;

CREATE SEQUENCE IF NOT EXISTS session_short_id_seq START 1;

CREATE TABLE test_sessions (
  test_session_id TEXT PRIMARY KEY DEFAULT ('ES' || LPAD(nextval('session_short_id_seq')::text, 3, '0')),
  user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title            TEXT,
  total_cost_usd   DOUBLE PRECISION,
  summary          TEXT,
  manually_edited   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eval_results (
  eval_result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id    TEXT NOT NULL REFERENCES test_sessions(test_session_id) ON DELETE CASCADE,
  test_case_id       TEXT NOT NULL REFERENCES test_cases(test_case_id) ON DELETE CASCADE,
  evren_response_id  UUID NOT NULL REFERENCES evren_responses(evren_response_id) ON DELETE CASCADE,
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

CREATE TRIGGER test_sessions_updated_at
  BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER eval_results_updated_at
  BEFORE UPDATE ON eval_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_test_sessions_user_id ON test_sessions(user_id);
CREATE INDEX idx_eval_results_test_session_id ON eval_results(test_session_id);

-- Re-apply RLS if you use it (adjust policy names to match your schema)
-- ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
