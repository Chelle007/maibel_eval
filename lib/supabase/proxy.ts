import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const url = request.nextUrl.clone();
  const isLogin = url.pathname === "/login";
  const isAuthCallback = url.pathname.startsWith("/auth/");
  const isAuthApi = url.pathname === "/api/auth/login";
  const isPublicAuth = isLogin || isAuthCallback || isAuthApi;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return isPublicAuth ? NextResponse.next({ request }) : NextResponse.redirect(new URL("/login", url));
  }

  try {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    });

    await supabase.auth.getClaims();
    const { data } = await supabase.auth.getSession();
    const hasSession = !!data?.session?.user;

    if (!hasSession && !isPublicAuth) {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (hasSession && isLogin) {
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (_err) {
    return isPublicAuth ? NextResponse.next({ request }) : NextResponse.redirect(new URL("/login", url));
  }
}
