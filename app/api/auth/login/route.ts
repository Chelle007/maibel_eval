import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/route-handler";

/**
 * POST /api/auth/login – sign in (server-side to avoid CORS / "Failed to fetch").
 * Body: { email, password }. Sets session cookies on success.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const supabase = createRouteHandlerClient(request, response);

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return response;
}
