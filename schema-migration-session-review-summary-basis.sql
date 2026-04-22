-- Fingerprint of per-row comparison JSON when session_review_summary was last aligned (AI draft or manual save).
-- Safe to run multiple times.

ALTER TABLE test_sessions
ADD COLUMN IF NOT EXISTS session_review_summary_basis_fingerprint TEXT;
