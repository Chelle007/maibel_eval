import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/auth/sync – ensure current auth user has a row in USERS table.
 * Call this while logged in if you're in Auth but missing from USERS.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const admin = createAdminClient();
  const table = "users";

  const { data: existing } = await (admin as any)
    .from(table)
    .select("user_id, email, full_name, is_owner")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      message: "Already in USERS table",
      appUser: existing,
    });
  }

  const { data: existingAny } = await (admin as any).from(table).select("user_id").limit(1);
  const isFirstUser = !existingAny?.length;

  const { error: insertError } = await (admin as any).from(table).insert({
    user_id: user.id,
    email: user.email ?? user.id,
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    is_owner: isFirstUser,
  });

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 }
    );
  }

  const { data: inserted } = await (admin as any)
    .from(table)
    .select("user_id, email, full_name, is_owner")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    ok: true,
    message: "Created USERS row",
    appUser: inserted,
  });
}
