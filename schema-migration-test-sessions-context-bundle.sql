-- Adds context bundle metadata to test_sessions (Phase 1).
-- Safe to run multiple times.

ALTER TABLE test_sessions
ADD COLUMN IF NOT EXISTS context_bundle_id TEXT;

ALTER TABLE test_sessions
ADD COLUMN IF NOT EXISTS context_extended_enabled BOOLEAN;

