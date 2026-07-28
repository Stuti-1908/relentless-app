import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/server";

// Auto-provision a new user into the shared coaching base so their dashboard + SMS automation work
// with NO manual Phase-0. Idempotent: no-op if already provisioned. Server-side tokens only.

const AIRTABLE_API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";
const GHL_API = process.env.GHL_API_URL || "https://services.leadconnectorhq.com";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appjnWxg9sB3PV7Da";

function e164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? "+" + d : null;
}
function newClientId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
  return "client_" + s;
}
// Validates a real IANA timezone identifier (Node's Intl supports this too — no client-only APIs needed).
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
  
  let { userId, ctx, profile } = await getClientContext();
  
  const isDev = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("localhost") || process.env.NODE_ENV === "development";
  console.log("[DEBUG api/provision] isDev:", isDev, "NODE_ENV:", process.env.NODE_ENV, "SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL, "userId:", userId);
  if (!userId && isDev) {
    // 1. Try reading Authorization header (e.g. Bearer <userId>)
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      userId = authHeader.substring(7);
      console.log("[DEBUG api/provision] extracted userId from authorization header:", userId);
    }

    // 2. Fallback to reading request body
    if (!userId) {
      try {
        const text = await req.text();
        console.log("[DEBUG api/provision] raw body text:", text);
        if (text.trim()) {
          const body = JSON.parse(text);
          console.log("[DEBUG api/provision] parsed body:", body);
          if (body && body.userId) {
            userId = body.userId;
          }
        }
      } catch (e) {
        console.error("[api/provision] parse error:", e);
      }
    }

    // 3. Load profile and context if userId was found
    if (userId) {
      try {
        const supabase = await createClient();
        const { data: p } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        console.log("[DEBUG api/provision] found profile for userId:", p);
        if (p) {
          profile = p as Record<string, unknown>;
          const str = (v: unknown): string | null =>
            typeof v === "string" && v.trim() !== "" ? v.trim() : null;
          ctx = {
            userId: userId!,
            clientId: str(p.client_id),
            baseId: str(p.airtable_base_id),
            ghlContactId: str(p.ghl_contact_id),
            plan: str(p.plan) ?? "standard",
          };
        }
      } catch (dbErr) {
        console.error("[api/provision] db fetch profile error:", dbErr);
      }
    }
  }

  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  // Idempotent — already provisioned.
  if (ctx?.clientId && ctx?.baseId) {
    return NextResponse.json({ ok: true, already: true, clientId: ctx.clientId });
  }
  const pat = process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT;
  const ghl = process.env.GHL_TOKEN;
  const ghlLoc = process.env.GHL_LOCATION_ID;
  if (!pat) return NextResponse.json({ ok: false, reason: "no_airtable_token" }, { status: 500 });
  const p = profile || {};
  const fullName = (typeof p.full_name === "string" ? p.full_name : "").trim() || "Client";
  const phone = e164(p.phone);
  const email = typeof p.email === "string" ? p.email : null;
  const goal = typeof p.primary_goal === "string" ? p.primary_goal : null;
  const plan = (ctx?.plan && ctx.plan !== "standard" ? ctx.plan : (typeof p.plan === "string" ? p.plan : "standard"));
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

  // 2. Airtable tbl_client_profile row.
  const fields: Record<string, unknown> = {
    client_id: clientId,
    full_name: fullName,
    plan,
    // Starts at 2, not 1: the immediate welcome SMS above already covers the Day-1 theme,
    // so tomorrow's 7-Day Onboarding cron should send Day-2 content, not repeat Day-1.
    onboarding_day: 2,
    active: true,
    onboarded_date: new Date().toISOString().slice(0, 10),
  };
  if (phone) fields.phone_number = phone;
  if (email) fields.email = email;
  if (goal) fields.top_priority_1 = goal;
  if (isValidTimezone(p.timezone)) fields.timezone = p.timezone;
  if (ghlContactId) fields.ghl_contact_id = ghlContactId;
  try {
    const r = await fetch(`${AIRTABLE_API}/${BASE_ID}/tbl_client_profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("[provision] Airtable create failed", r.status, t.slice(0, 200));
      return NextResponse.json({ ok: false, reason: "airtable_create_failed" }, { status: 502 });
    }
  } catch (e) {
    console.error("[provision] Airtable error", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "airtable_error" }, { status: 502 });
  }

  // 2b. Immediate Day-1 welcome SMS (best-effort) — don't make the new client wait for the
  // 6:30 AM onboarding cron to hear from us; they should get a text the moment they sign up.
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

  // 3. Link the user's Supabase profile to the new client (own-row update; RLS allows).
  const supabase = await createClient();
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ client_id: clientId, airtable_base_id: BASE_ID, ghl_contact_id: ghlContactId, plan })
    .eq("id", userId);
  if (upErr) {
    console.error("[provision] supabase link failed", upErr.message);
    return NextResponse.json({ ok: false, reason: "supabase_link_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, clientId, ghlContactId, provisioned: true });
}
