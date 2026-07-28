import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";

// Proxies one War Room turn from the dashboard to the n8n War Room workflow. Pro-only. The phone
// (which the workflow matches against the client profile) is derived SERVER-SIDE — never trusted
// from the browser. The n8n webhook returns { reply: "<assistant text>" }.

const WARROOM_URL =
  process.env.N8N_WARROOM_URL || "https://167.233.94.171.nip.io/webhook/war-room";
const AIRTABLE_API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";

export async function POST(req: Request) {
  if (!sameOriginOk(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const { userId, ctx } = await getClientContext();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const baseId = ctx?.baseId;
  const clientId = ctx?.clientId;
  if (!baseId) return NextResponse.json({ error: "not_provisioned" }, { status: 400 });

  let message = "";
  try {
    message = String((await req.json())?.message ?? "").slice(0, 1000);
  } catch {
    /* ignore */
  }
  if (!message.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  const pat = process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT;
  if (!pat) return NextResponse.json({ error: "not configured" }, { status: 500 });

  // Derive the client's phone + plan from their Airtable profile. We gate on the AIRTABLE plan
  // (the same source /api/coaching and the n8n backend use) — NOT the Supabase ctx.plan, which can
  // drift out of sync. The workflow matches {phone_number}=From.
  let phone = "";
  let airtablePlan = "";
  try {
    const filt = encodeURIComponent(`{client_id}='${(clientId ?? "").replace(/'/g, "")}'`);
    const r = await fetch(
      `${AIRTABLE_API}/${baseId}/${encodeURIComponent("tbl_client_profile")}?filterByFormula=${filt}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${pat}` }, cache: "no-store" }
    );
    const d = (await r.json()) as { records?: { fields?: { phone_number?: unknown; plan?: unknown } }[] };
    phone = String(d?.records?.[0]?.fields?.phone_number ?? "");
    airtablePlan = String(d?.records?.[0]?.fields?.plan ?? "");
  } catch {
    /* fall through to the guards below */
  }

  const plan = (airtablePlan || ctx?.plan || "standard").toLowerCase();
  if (plan !== "pro") {
    return NextResponse.json({ error: "War Room is a Pro feature." }, { status: 403 });
  }
  if (!phone) return NextResponse.json({ error: "no phone on your profile yet" }, { status: 400 });

  // Relay one turn (Twilio-style form params) to the n8n War Room webhook.
  const form = new URLSearchParams({ From: phone, Body: message, MessageSid: `web-${Date.now()}` });
  try {
    const r = await fetch(WARROOM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = (await r.json().catch(() => ({}))) as { reply?: unknown };
    return NextResponse.json({ reply: typeof data?.reply === "string" ? data.reply : "" });
  } catch (e) {
    console.error("warroom relay failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "War Room is unreachable right now." }, { status: 502 });
  }
}
