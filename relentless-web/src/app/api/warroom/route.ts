import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";

// Proxies one War Room turn from the dashboard to the n8n War Room workflow. Pro-only. The phone
// (which the workflow matches against the client profile) is derived SERVER-SIDE — never trusted
// from the browser. The n8n webhook returns { reply: "<assistant text>" }.

const WARROOM_URL =
  process.env.N8N_WARROOM_URL || "https://167.233.94.171.nip.io/webhook/war-room";

export async function POST(req: Request) {
  if (!sameOriginOk(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const { userId, ctx } = await getClientContext();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const clientId = ctx?.clientId;
  // Provisioned = has a client_id (Supabase client_profile row), not the legacy
  // airtable_base_id column — see api/provision/route.ts's 2026-08-17 rewrite.
  // Checking baseId here (as this route did before) would permanently reject
  // every newly-provisioned user, since provision no longer sets that column.
  if (!clientId) return NextResponse.json({ error: "not_provisioned" }, { status: 400 });

  let message = "";
  try {
    message = String((await req.json())?.message ?? "").slice(0, 1000);
  } catch {
    /* ignore */
  }
  if (!message.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });

  // Derive the client's phone + plan from the Supabase v_clients view (which matches n8n).
  // The workflow matches {phone_number}=From.
  let phone = "";
  let supaPlan = "";
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await sb.from("v_clients").select("phone_number, plan").eq("client_id", clientId ?? "").maybeSingle();
    if (error) console.error("warroom v_clients query error:", error);
    phone = data?.phone_number || "";
    supaPlan = data?.plan || "";
  } catch (err) {
    console.error("warroom v_clients catch:", err);
    /* fall through to the guards below */
  }

  const plan = (supaPlan || ctx?.plan || "standard").toLowerCase();
  if (plan !== "pro") {
    return NextResponse.json({ error: "War Room is a Pro feature." }, { status: 403 });
  }
  if (!phone) return NextResponse.json({ error: "no phone on your profile yet" }, { status: 400 });

  // Relay one turn (Twilio-style form params) to the n8n War Room webhook.
  const form = new URLSearchParams({ From: phone, Body: message, MessageSid: `web-${Date.now()}`, contactId: clientId ?? "" });
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
