-- Run this on an existing DB that has categories without deleted_at.
-- Adds soft-delete support: deleted_at column and unique name for active categories only.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Drop old UNIQUE on name if it exists (e.g. from original schema)
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- Ensure unique names only among non-deleted categories
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_not_deleted
  ON categories (name) WHERE deleted_at IS NULL;
