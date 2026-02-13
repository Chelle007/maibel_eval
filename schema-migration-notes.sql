-- Add optional notes column to test_cases (skip if already applied).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'test_cases' AND column_name = 'notes'
  ) THEN
    ALTER TABLE test_cases ADD COLUMN notes TEXT;
  END IF;
END $$;
