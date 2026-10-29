import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase redirects here after Google OAuth or email-confirmation links.
// We exchange the `code` for a session cookie, then send the user onward.
//
// Calendar connect flow reuses this same callback (next=/connections?calendar=connecting): when
// the OAuth request included the calendar.readonly scope, Supabase's session carries a fresh
// provider_refresh_token here — this is the ONLY moment that token is available, so we persist it
// to the user's profile row immediately before redirecting onward.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/consent";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] code exchange failed", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth&reason=${encodeURIComponent(error.message.slice(0, 160))}`);
    }
    {
      const refreshToken = data.session?.provider_refresh_token;
      if (refreshToken && next.startsWith("/connections")) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const isGmail = next.includes("gmail=connecting");
          const update = isGmail
            ? { gmail_refresh_token: refreshToken, gmail_connected_at: new Date().toISOString() }
            : { google_calendar_refresh_token: refreshToken, google_calendar_connected_at: new Date().toISOString() };
          await supabase.from("profiles").update(update).eq("id", user.id);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Google/Supabase sent the user back with an error (denied, blocked app, expired link...) or no code.
  // Pass the reason on so the login page can show it instead of silently reloading.
  const reason = searchParams.get("error_description") || searchParams.get("error") || "no_code";
  console.error("[auth/callback] sign-in failed", reason);
  return NextResponse.redirect(`${origin}/login?error=auth&reason=${encodeURIComponent(reason.slice(0, 160))}`);
}
