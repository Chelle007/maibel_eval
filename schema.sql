-- Maibel Eval – PostgreSQL schema (e.g. Supabase)
-- Uses lowercase, unquoted table/column names so PostgREST exposes public.test_cases, etc. in the schema cache.

-- Extensions (Supabase usually has these)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLES (order matters for foreign keys)
-- =============================================================================

CREATE TABLE users (
  user_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT,
  is_owner   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User-editable categories (add/remove/rename via UI; soft delete via deleted_at)
CREATE TABLE categories (
  category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique name only for non-deleted rows (enforced in app or partial unique index)
CREATE UNIQUE INDEX idx_categories_name_not_deleted ON categories (name) WHERE deleted_at IS NULL;

-- id: stable UUID PK. test_case_id: editable display id (e.g. P0-001)
-- type: 'single_turn' (one user message → one Evren response) or 'multi_turn' (conversation)
-- turns: for multi_turn, JSONB array of user inputs only, e.g. ["input 1", "input 2"]; null for single_turn
CREATE TABLE test_cases (
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

CREATE SEQUENCE IF NOT EXISTS session_short_id_seq START 1;

-- session_id: stable UUID PK. test_session_id: editable display id (e.g. ES001)
CREATE TABLE test_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id    TEXT NOT NULL UNIQUE DEFAULT ('ES' || LPAD(nextval('session_short_id_seq')::text, 3, '0')),
  user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title              TEXT,
  total_cost_usd     DOUBLE PRECISION,
  total_eval_time_seconds DOUBLE PRECISION,
  summary            TEXT,
  mode               TEXT NOT NULL DEFAULT 'single' CHECK (mode IN ('single', 'comparison')),
  manually_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- evren_responses: JSONB array of { "response": "...", "detected_flags": "..." } (one per turn)
CREATE TABLE eval_results (
  eval_result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES test_sessions(session_id) ON DELETE CASCADE,
  test_case_uuid     UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
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

CREATE TABLE default_settings (
  default_setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evren_api_url      TEXT,
  evaluator_model    TEXT,
  evaluator_prompt   TEXT,
  summarizer_model   TEXT,
  summarizer_prompt  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- TRIGGERS (auto-update updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_cases_updated_at
  BEFORE UPDATE ON test_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_sessions_updated_at
  BEFORE UPDATE ON test_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER eval_results_updated_at
  BEFORE UPDATE ON eval_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER default_settings_updated_at
  BEFORE UPDATE ON default_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- INDEXES (optional, for common lookups)
-- =============================================================================

CREATE INDEX idx_test_sessions_user_id ON test_sessions(user_id);
CREATE INDEX idx_test_sessions_test_session_id ON test_sessions(test_session_id);
CREATE INDEX idx_eval_results_session_id ON eval_results(session_id);
CREATE INDEX idx_eval_results_test_case_uuid ON eval_results(test_case_uuid);
CREATE INDEX idx_test_cases_category_id ON test_cases(category_id);
CREATE INDEX idx_test_cases_test_case_id ON test_cases(test_case_id);

-- =============================================================================
-- ROW LEVEL SECURITY (Supabase)
-- =============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE default_settings ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS and has full access (e.g. backend with service key).
-- authenticated: users can do anything on USERS except INSERT; only owner can add new users.
-- (Assumes auth.uid() = USERS.user_id, e.g. you use Supabase Auth and store that id in USERS.)

CREATE POLICY "Users: service_role all"
  ON users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: read, update, delete any user (but not insert)
CREATE POLICY "Users: authenticated select"
  ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users: authenticated update"
  ON users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users: authenticated delete"
  ON users FOR DELETE TO authenticated USING (true);

-- Only owner can insert (add new user)
CREATE POLICY "Users: authenticated insert only owner"
  ON users FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_owner FROM users WHERE user_id = auth.uid()) = true
  );

CREATE POLICY "Categories: service_role all"
  ON categories FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Categories: authenticated all"
  ON categories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Test cases: service_role all"
  ON test_cases FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users (logged in) can do everything on test_cases
CREATE POLICY "Test cases: authenticated all"
  ON test_cases FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Test sessions: service_role all"
  ON test_sessions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Test sessions: authenticated all"
  ON test_sessions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Eval results: service_role all"
  ON eval_results FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Eval results: authenticated all"
  ON eval_results FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Default settings: service_role all"
  ON default_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Default settings: authenticated all"
  ON default_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Optional: allow anon/authenticated to read (if your app uses anon key for reads)
-- CREATE POLICY "Test cases: anon read" ON test_cases FOR SELECT TO anon USING (true);
-- CREATE POLICY "Test sessions: anon read" ON test_sessions FOR SELECT TO anon USING (true);
-- etc.

-- =============================================================================
-- GRANTS (Supabase roles)
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO service_role;
GRANT SELECT, UPDATE, DELETE ON users TO authenticated;
GRANT INSERT ON users TO authenticated;  -- RLS restricts to owner only
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON test_cases TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON test_sessions TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON eval_results TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON default_settings TO service_role, authenticated;

-- If you use anon key for API (e.g. Next.js server using service_role in env):
-- grant only what the anon key needs, e.g. SELECT on some tables:
-- GRANT SELECT ON test_cases TO anon;
-- GRANT SELECT, INSERT ON test_sessions TO anon;
