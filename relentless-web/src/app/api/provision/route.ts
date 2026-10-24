import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/phone";

// Auto-provision a new user into the shared coaching base so their dashboard + SMS automation work
// with NO manual Phase-0. Idempotent: no-op if already provisioned. Server-side tokens only.
//
// Rewritten 2026-08-17: this route was still writing to Airtable's tbl_client_profile,
// dead since the 2026-08-06 Supabase migration (same bug independently found and
// fixed in api/profile-sync — see that file's history). Every user who signed up
// since 08-06 silently got NO client_profile row: no coaching data, no nudges, no
// briefings, nothing — the dashboard would show empty/static content forever,
// indistinguishable from "not yet provisioned" because that's exactly what it was.
//
// Identity split, same convention as the rest of the project (see
// build/migration/001_schema_phase1.sql): profiles holds full_name/phone/timezone/
// ghl_contact_id/plan; client_profile holds coaching-only fields keyed by client_id.
// A new user therefore needs BOTH a client_profile insert (coaching row) and a
// profiles update (client_id/ghl_contact_id/plan link) — the same two writes
// provision always intended, just now against the right store.

const GHL_API = process.env.GHL_API_URL || "https://services.leadconnectorhq.com";

function newClientId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
  return "client_" + s;
}

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameOriginOk(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });

  const { userId, ctx, profile } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  // Idempotent — already provisioned.
  if (ctx?.clientId) {
    return NextResponse.json({ ok: true, already: true, clientId: ctx.clientId });
  }

  const ghl = process.env.GHL_TOKEN;
  const ghlLoc = process.env.GHL_LOCATION_ID;
  const p = profile || {};
  const fullName = (typeof p.full_name === "string" ? p.full_name : "").trim() || "Client";
  const phone = toE164(typeof p.phone === "string" ? p.phone : undefined);
  const email = typeof p.email === "string" ? p.email : null;
  const goal = typeof p.primary_goal === "string" ? p.primary_goal : null;
  const plan = ctx?.plan && ctx.plan !== "standard" ? ctx.plan : typeof p.plan === "string" ? p.plan : "standard";
  const clientId = newClientId();

  // 1. GHL contact (best-effort — provisioning still succeeds if GHL is slow/misconfigured).
  let ghlContactId: string | null = null;
  if (ghl && ghlLoc && phone) {
    try {
      const r = await fetch(`${GHL_API}/contacts/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ghl}`, Version: "2021-07-28", "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: ghlLoc, name: fullName, phone, ...(email ? { email } : {}) }),
      });
      if (r.ok) {
        const d = (await r.json()) as { contact?: { id?: string } };
        ghlContactId = d.contact?.id ?? null;
      } else {
        console.error("[provision] GHL contact failed", r.status);
      }
    } catch (e) {
      console.error("[provision] GHL contact error", e instanceof Error ? e.message : e);
    }
  }

  // client_profile has no browser-write RLS policy by design (see 001_schema_phase1.sql
  // §6) — this insert needs the service-role client. The profiles update below stays on
  // the session client since profiles already allows a user to write their own row
  // (onboarding/page.tsx's upsert already relies on this working).
  const supabaseService = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 2. client_profile row — coaching-only fields, per the identity-split convention.
  // onboarding_day starts at 2, not 1: the immediate welcome SMS below already covers
  // the Day-1 theme, so tomorrow's 7-Day Onboarding cron should send Day-2 content.
  const clientProfileFields: Record<string, unknown> = {
    client_id: clientId,
    active: true,
    onboarding_day: 2,
    onboarded_date: new Date().toISOString().slice(0, 10),
  };
  if (goal) clientProfileFields.top_priority_1 = goal;
  if (email) clientProfileFields.email = email;
  if (isValidTimezone(p.timezone)) clientProfileFields.timezone_override = p.timezone;
  if (phone) clientProfileFields.phone_override = phone;

  // 3. Link the user's own profiles row to the new client_id FIRST: client_profile.client_id
  // has a foreign key to profiles.client_id, so inserting client_profile before this link
  // is rejected (23503) and the client is never provisioned.
  const supabaseSession = await createServerClient();
  const { error: upErr } = await supabaseSession
    .from("profiles")
    .update({ client_id: clientId, ghl_contact_id: ghlContactId, plan })
    .eq("id", userId);
  if (upErr) {
    console.error("[provision] profiles link failed", upErr.message);
    return NextResponse.json({ ok: false, reason: "profiles_link_failed" }, { status: 502 });
  }

  const { error: cpErr } = await supabaseService.from("client_profile").insert(clientProfileFields);
  if (cpErr) {
    console.error("[provision] client_profile insert failed", cpErr.message);
    // Undo the link so a retry provisions cleanly instead of short-circuiting on "already".
    await supabaseService.from("profiles").update({ client_id: null, ghl_contact_id: null }).eq("id", userId);
    return NextResponse.json({ ok: false, reason: "client_profile_insert_failed" }, { status: 502 });
  }

  // 4. Immediate Day-1 welcome SMS (best-effort), only once provisioning fully succeeded.
  if (ghl && ghlContactId) {
    try {
      const welcome =
        `Welcome to Relentless AI, ${fullName.split(" ")[0] || "there"}. You'll get a focused ` +
        `morning briefing and an evening Executive Score daily — replying to texts helps it learn ` +
        `you faster. This is your performance edge, not another app to manage.`;
      await fetch(`${GHL_API}/conversations/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ghl}`, Version: "2021-04-15", "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SMS", contactId: ghlContactId, message: welcome }),
      });
    } catch (e) {
      console.error("[provision] welcome SMS error", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, clientId, ghlContactId, provisioned: true });
}
