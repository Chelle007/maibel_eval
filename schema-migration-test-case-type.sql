-- Add type column to test_cases: 'single_turn' (default) or 'multi_turn'.
-- Existing rows get type = 'single_turn'.
-- Add turns column for multi_turn: JSONB array of user inputs only, e.g. ["input 1", "input 2"].

ALTER TABLE test_cases
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'single_turn'
    CHECK (type IN ('single_turn', 'multi_turn'));

ALTER TABLE test_cases
  ADD COLUMN IF NOT EXISTS turns JSONB;
