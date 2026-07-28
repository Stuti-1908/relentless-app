import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes a signed-out user is allowed to see. Everything else requires a session.
// /api/health is a public liveness probe (no auth) so uptime monitors can ping it.
const PUBLIC_PATHS = ["/welcome", "/login", "/auth", "/api/health", "/diagnostic", "/api/diagnostic", "/api/mock", "/api/provision"];

// Next.js 16 renamed the "middleware" convention to "proxy".
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // Not signed in and trying to reach a protected page -> send to login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Already signed in and sitting on an entry route (/login or /) -> go straight into the app in a
  // SINGLE redirect, with no flash. A returning, already-consented user lands on /dashboard directly
  // instead of bouncing through /login -> /consent -> /onboarding -> /dashboard (each of which used
  // to paint briefly). Only a brand-new user who hasn't consented is routed to /consent.
  if (user && (path === "/login" || path === "/")) {
    const consented = Boolean(user.user_metadata?.consented_at);
    const url = request.nextUrl.clone();
    url.pathname = consented ? "/dashboard" : "/consent";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals, static assets, and API routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
