import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/route-handler";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/auth/signup – create account (server-side to avoid CORS / "Failed to fetch").
 * Body: { email, password, full_name? }. Sets session cookies on success.
 * Also creates a row in users with password_hash set (hashed).
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
    const admin = createAdminClient();
    const { data: existing } = await (admin as any).from("users").select("user_id").limit(1);
    const isFirstUser = !existing?.length;
    const passwordHash = await hashPassword(password);
    const { error: insertError } = await (admin as any).from("users").insert({
      user_id: signUpData.user.id,
      email,
      password_hash: passwordHash,
      full_name: fullName,
      is_owner: isFirstUser,
    });
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

async function hashPassword(password: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(password).digest("hex");
}
