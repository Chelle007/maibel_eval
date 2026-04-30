-- Optional one-time cleanup after switching category DELETE API to permanent delete.
-- Removes rows that were only soft-deleted (deleted_at set) so they no longer linger in Postgres.
DELETE FROM categories WHERE deleted_at IS NOT NULL;
