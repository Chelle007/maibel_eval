import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UsersRow } from "@/lib/db.types";

/**
 * POST /api/auth/add-user – owner only. Body: { email, password, full_name, is_owner }.
 * Creates Supabase Auth user and USERS row.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user: caller } } = await supabase.auth.getUser();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: appUser } = await admin
    .from("users")
    .select("is_owner")
    .eq("user_id", caller.id)
    .single();
  const isOwner = (appUser as Pick<UsersRow, "is_owner"> | null)?.is_owner;
  if (!isOwner) return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });

  let body: { email: string; password: string; full_name: string; is_owner: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { email, password, full_name, is_owner } = body;
  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
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

  // Upsert: trigger may have already inserted the row, so update instead of failing on duplicate key
  const { error: upsertError } = await admin
    .from("users")
    .upsert(
      {
        user_id: newAuthUser.user.id,
        email: email.trim(),
        full_name: full_name?.trim() || null,
        is_owner: !!is_owner,
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ user_id: newAuthUser.user.id, email: email.trim() });
}
