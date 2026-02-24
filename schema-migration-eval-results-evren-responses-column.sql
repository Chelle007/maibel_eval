-- Move Evren response data from evren_responses table into eval_results.evren_responses (JSONB array).
-- Format: [ {"response": "...", "detected_flags": "..."}, ... ]
-- Then drop evren_response_id FK/column and drop evren_responses table.

-- 1. Add new column (nullable first for backfill)
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS evren_responses JSONB;

-- 2. Backfill from evren_responses (one row per eval_result → array of one object)
UPDATE eval_results er
SET evren_responses = COALESCE(
  (
    SELECT jsonb_build_array(
      jsonb_build_object(
        'response', r.evren_response,
        'detected_flags', COALESCE(r.detected_states, '')
      )
    )
    FROM evren_responses r
    WHERE r.evren_response_id = er.evren_response_id
  ),
  '[]'::jsonb
);

-- 3. Drop FK and column
ALTER TABLE eval_results
  DROP CONSTRAINT IF EXISTS eval_results_evren_response_id_fkey;

ALTER TABLE eval_results
  DROP COLUMN IF EXISTS evren_response_id;

-- 4. Drop evren_responses table (triggers, indexes, RLS drop with table)
DROP TABLE IF EXISTS evren_responses;

-- 5. Optional: make column NOT NULL for new inserts (uncomment if you want)
-- ALTER TABLE eval_results ALTER COLUMN evren_responses SET NOT NULL;
