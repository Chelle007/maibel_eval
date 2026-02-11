import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  await supabase.auth.getClaims();

  const url = request.nextUrl.clone();
  const isLogin = url.pathname === "/login";
  const isSignup = url.pathname === "/signup";
  const isAuthCallback = url.pathname.startsWith("/auth/");
  const isAuthApi = url.pathname === "/api/auth/signup" || url.pathname === "/api/auth/login";
  const isPublicAuth = isLogin || isSignup || isAuthCallback || isAuthApi;

  const { data } = await supabase.auth.getSession();
  const hasSession = !!data?.session?.user;

  if (!hasSession && !isPublicAuth) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && (isLogin || isSignup)) {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
