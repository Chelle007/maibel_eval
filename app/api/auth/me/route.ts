import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, UsersRow } from "@/lib/db.types";

/**
 * GET /api/auth/me – current user and USERS row (includes is_owner).
 * Syncs auth user to USERS if missing (e.g. first Google login).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ user: null, appUser: null });
  }

  const admin = createAdminClient();
  const { data: appUser } = await admin
    .from("users")
    .select("user_id, email, full_name, is_owner")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!appUser) {
    const { data: existing } = await admin.from("users").select("user_id").limit(1);
    const isFirstUser = !existing?.length;
    const newUserRow = {
      user_id: user.id,
      email: user.email ?? user.id,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      is_owner: isFirstUser,
    } as Database["public"]["Tables"]["users"]["Insert"];
    await admin.from("users").insert(newUserRow as any);
    const { data: inserted } = await admin
      .from("users")
      .select("user_id, email, full_name, is_owner")
      .eq("user_id", user.id)
      .single();
    const row = inserted as Pick<UsersRow, "user_id" | "email" | "full_name" | "is_owner"> | null;
    return NextResponse.json({
      user: { id: user.id, email: user.email },
      appUser: row ?? { user_id: user.id, email: user.email, full_name: null, is_owner: false },
    });
  }

  const row = appUser as Pick<UsersRow, "user_id" | "email" | "full_name" | "is_owner">;
  return NextResponse.json({
    user: { id: user.id, email: user.email },
    appUser: { user_id: row.user_id, email: row.email, full_name: row.full_name, is_owner: row.is_owner },
  });
}
