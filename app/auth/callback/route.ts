import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const admin = createAdminClient();
        const table = "users";
        const { data: existing } = await (admin as any).from(table).select("user_id").limit(1);
        const isFirstUser = !existing?.length;
        await (admin as any).from(table).upsert(
          {
            user_id: user.id,
            email: user.email ?? user.id,
            full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
            is_owner: isFirstUser,
          },
          { onConflict: "user_id" }
        );
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
