import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { toE164 } from "@/lib/phone";
import { createClient } from "@supabase/supabase-js";

// W1 — Write path: push the signed-in user's web profile into THEIR client_profile
// row (client resolved from their profiles row), so the n8n briefing/nudges use
// their data. An unprovisioned user has no client_profile row -> no-op.
//
// Rewritten 2026-08-17: was still writing to Airtable's tbl_client_profile, dead
// since the 2026-08-06 Supabase migration — same bug independently found and
// fixed in api/provision (see that file's history for the full story). Every
// profile edit since 08-06 silently wrote nowhere real.
//
// Identity split, same convention as the rest of the project: full_name/phone/
// timezone live on profiles (browser writes those directly via Supabase RLS,
// already correct — see onboarding/page.tsx), so this route only needs to sync
// the fields client_profile actually has: top_priority_1 (top_priority_1 has no
// profiles equivalent), plus phone_override/timezone_override as the n8n-facing
// escape hatch when a client wants their coaching contact info to differ from
// their login profile (rare, but the column exists for exactly this).

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  }

  const { userId, ctx, profile } = await getClientContext();
  if (!userId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  const clientId = ctx?.clientId;
  if (!clientId) {
    return NextResponse.json({ ok: false, reason: "not_provisioned" }, { status: 200 });
  }
  if (!profile) {
    return NextResponse.json({ ok: false, reason: "no_profile" }, { status: 200 });
  }

  // Build the client_profile patch (only include fields that have a value).
  const fields: Record<string, string> = {};
  if (typeof profile.primary_goal === "string" && profile.primary_goal.trim()) {
    fields.top_priority_1 = profile.primary_goal;
  }
  const phone = toE164(profile.phone as string | undefined);
  if (phone) fields.phone_override = phone;
  if (isValidTimezone(profile.timezone)) fields.timezone_override = profile.timezone;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ ok: true, synced: [], note: "nothing to sync" });
  }

  // client_profile has no browser-write RLS policy by design (see 001_schema_phase1.sql
  // §6 — "All writes to these tables come from n8n via the service_role key"). This is a
  // legitimate server-side write on the signed-in user's own row, not something RLS
  // should gate, so it uses the service-role client rather than the session-bound one —
  // same pattern api/warroom/route.ts already established for its v_clients read.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await supabase.from("client_profile").update(fields).eq("client_id", clientId);

  if (error) {
    console.error(`[profile-sync] Supabase write failed: ${error.message}`);
    return NextResponse.json({ ok: false, reason: "write_failed", code: "supabase_write_error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, synced: Object.keys(fields) });
}
