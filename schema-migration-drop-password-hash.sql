-- Run in Supabase SQL Editor.
-- Passwords are stored only in Supabase Auth; password_hash in public.users was never used for login.
-- After running this, re-run schema-trigger-auth-to-users.sql so the trigger no longer references password_hash.

ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
