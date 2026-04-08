-- Adds eval_results.comparison (used by lib/comparator.ts + session UI).
-- Safe to run multiple times.

ALTER TABLE eval_results
ADD COLUMN IF NOT EXISTS comparison JSONB;

