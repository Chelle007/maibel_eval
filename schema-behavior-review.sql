-- Per-version human behavior review on eval_results (see lib/behavior-review.ts).
ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS behavior_review JSONB NOT NULL DEFAULT '{}'::jsonb;
