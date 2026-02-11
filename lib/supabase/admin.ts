import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

/**
 * Server-only Supabase client with service role. Use for admin actions:
 * syncing auth user to USERS, creating users (add-user). Never expose to client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (add to .env.local from Supabase Dashboard → Settings → API)");
  return createSupabaseClient<Database>(url, key, { auth: { persistSession: false } });
}
