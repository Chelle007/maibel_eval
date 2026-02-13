-- Maibel Eval – drop all tables (run this in Supabase SQL editor, then run schema.sql)
-- Order: drop tables that reference others first (or use CASCADE).

DROP TABLE IF EXISTS eval_results;
DROP TABLE IF EXISTS evren_responses;
DROP TABLE IF EXISTS test_sessions;
DROP TABLE IF EXISTS test_cases;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS default_settings;

-- If you previously had uppercase-quoted tables, drop those too:
DROP TABLE IF EXISTS "EVAL_RESULTS";
DROP TABLE IF EXISTS "EVREN_RESPONSES";
DROP TABLE IF EXISTS "TEST_SESSIONS";
DROP TABLE IF EXISTS "TEST_CASES";
DROP TABLE IF EXISTS "CATEGORIES";
DROP TABLE IF EXISTS "USERS";
DROP TABLE IF EXISTS "DEFAULT_SETTINGS";
