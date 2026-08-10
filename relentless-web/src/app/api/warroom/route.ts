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

  // Derive the client's phone + plan from the Supabase v_clients view (which matches n8n).
  // The workflow matches {phone_number}=From.
  let phone = "";
  let supaPlan = "";
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = await createClient();
    const { data } = await sb.from("v_clients").select("phone_number, plan").eq("client_id", clientId ?? "").maybeSingle();
    phone = data?.phone_number || "";
    supaPlan = data?.plan || "";
  } catch {
    /* fall through to the guards below */
  }

  const plan = (supaPlan || ctx?.plan || "standard").toLowerCase();
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
