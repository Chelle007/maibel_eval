import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const table = "USERS";
  const { data: appUser } = await (admin as any)
    .from(table)
    .select("user_id, email, full_name, is_owner")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!appUser) {
    const { data: existing } = await (admin as any).from(table).select("user_id").limit(1);
    const isFirstUser = !existing?.length;
    await (admin as any).from(table).insert({
      user_id: user.id,
      email: user.email ?? user.id,
      password_hash: "(password)",
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      is_owner: isFirstUser,
    });
    const { data: inserted } = await (admin as any)
      .from(table)
      .select("user_id, email, full_name, is_owner")
      .eq("user_id", user.id)
      .single();
    return NextResponse.json({
      user: { id: user.id, email: user.email },
      appUser: inserted ?? { user_id: user.id, email: user.email, full_name: null, is_owner: false },
    });
  }

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    appUser: { user_id: appUser.user_id, email: appUser.email, full_name: appUser.full_name, is_owner: appUser.is_owner },
  });
}
