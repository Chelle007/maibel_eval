-- Seed a default user for local/dev when not using login.
-- Run in Supabase SQL Editor, then set DEFAULT_USER_ID in .env to the returned user_id.
-- Only run if you have no users yet (or use a distinct email).

INSERT INTO users (user_id, email, full_name, is_owner)
VALUES (
  gen_random_uuid(),
  'default@maibel-eval.local',
  'Default User',
  true
)
ON CONFLICT (email) DO NOTHING
RETURNING user_id, email;

-- If you already have a user, just look up their ID:
-- SELECT user_id, email FROM users LIMIT 1;
