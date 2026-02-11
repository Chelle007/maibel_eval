-- Run this in Supabase SQL Editor to fix "new row violates row-level security policy".
-- Adds policies and grants so authenticated (logged-in) users can use test_cases, etc.

-- test_cases
CREATE POLICY "Test cases: authenticated all"
  ON test_cases FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON test_cases TO authenticated;

-- evren_responses
CREATE POLICY "Evren responses: authenticated all"
  ON evren_responses FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON evren_responses TO authenticated;

-- test_sessions
CREATE POLICY "Test sessions: authenticated all"
  ON test_sessions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON test_sessions TO authenticated;

-- eval_results
CREATE POLICY "Eval results: authenticated all"
  ON eval_results FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON eval_results TO authenticated;

-- default_settings
CREATE POLICY "Default settings: authenticated all"
  ON default_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON default_settings TO authenticated;
