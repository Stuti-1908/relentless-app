import { NextResponse } from "next/server";

// Public, cheap liveness probe for uptime monitors. Returns 200 + build info + which integrations
// are configured (booleans only — never the secret values). No upstream calls, so it stays fast.
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "relentless-web",
    ts: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    region: process.env.VERCEL_REGION ?? null,
    configured: {
      supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      airtable: !!(process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT),
      ghl: !!process.env.GHL_TOKEN,
    },
  });
}
