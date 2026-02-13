-- Run this on an existing DB that still has expected_flags.
-- Renames column to expected_states for consistency.

ALTER TABLE test_cases RENAME COLUMN expected_flags TO expected_states;
