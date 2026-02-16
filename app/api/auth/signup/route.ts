import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/route-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/db.types";

/**
 * POST /api/auth/signup – create account (server-side to avoid CORS / "Failed to fetch").
 * Body: { email, password, full_name? }. Sets session cookies on success.
 * Also creates a row in users.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createRouteHandlerClient(request, response);

  let body: { email?: string; password?: string; full_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password;
  const fullName = body.full_name?.trim() || null;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName || undefined } },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (signUpData?.user) {
    let admin;
    try {
      admin = createAdminClient();
    } catch (err) {
      console.error("Signup: createAdminClient failed (is SUPABASE_SERVICE_ROLE_KEY set?)", err);
      return NextResponse.json(
        { error: "Server misconfiguration: missing SUPABASE_SERVICE_ROLE_KEY. Add it in .env.local from Supabase Dashboard → Settings → API. You can still sync this account via /api/auth/sync after logging in." },
        { status: 500 }
      );
    }
    const { data: existing } = await admin.from("users").select("user_id").limit(1);
    const isFirstUser = !existing?.length;
    const userRow = {
      user_id: signUpData.user.id,
      email,
      full_name: fullName,
      is_owner: isFirstUser,
    } as Database["public"]["Tables"]["users"]["Insert"];
    const { error: insertError } = await admin.from("users").insert(userRow as any);
    if (insertError) {
      console.error("Signup: failed to create users row", insertError);
      return NextResponse.json(
        { error: "Account created but failed to save profile. Try logging in or visit /api/auth/sync." },
        { status: 500 }
      );
    }
  }

  return response;
}
