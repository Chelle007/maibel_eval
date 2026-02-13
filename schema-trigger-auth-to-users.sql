-- Run this in Supabase SQL Editor (Dashboard → SQL Editor).
-- When a new user is created in Supabase Authentication (auth.users),
-- this trigger automatically creates a row in public.users so they appear
-- in your app even if the signup API route fails (e.g. missing service role key).

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_first boolean;
BEGIN
  SELECT (SELECT count(*) FROM public.users) = 0 INTO is_first;
  INSERT INTO public.users (user_id, email, full_name, is_owner)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.id::text),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    is_first
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if re-running this script
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();
