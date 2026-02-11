import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/add-user – owner only. Body: { email, password, full_name, owner }.
 * Creates Supabase Auth user and USERS row.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user: caller } } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const table = "USERS";
  const { data: appUser } = await (admin as any)
    .from(table)
    .select("owner")
    .eq("user_id", caller.id)
    .single();
  if (!appUser?.owner) return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });

  let body: { email: string; password: string; full_name: string; owner: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { email, password, full_name, owner } = body;
  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const { data: newAuthUser, error: createError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name?.trim() ?? null },
  });

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }
  if (!newAuthUser.user) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }

  const { error: insertError } = await (admin as any).from(table).insert({
    user_id: newAuthUser.user.id,
    email: email.trim(),
    password_hash: "(password)", // actual hash is in Supabase Auth
    full_name: full_name?.trim() || null,
    owner: !!owner,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ user_id: newAuthUser.user.id, email: email.trim() });
}
