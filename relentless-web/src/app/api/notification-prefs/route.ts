import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { sanitizePrefs } from "@/lib/notificationPrefs";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Notification preferences live on client_profile.notification_prefs (migration 012). client_profile
// has no browser-write RLS policy by design, so reads and writes go through the service role here,
// scoped to the signed-in user's own client_id. n8n reads the same column through v_clients.

function service() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET() {
  const { userId, ctx } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  if (!ctx?.clientId) return NextResponse.json({ ok: false, reason: "not_provisioned" }, { status: 200 });

  const { data, error } = await service()
    .from("client_profile")
    .select("notification_prefs")
    .eq("client_id", ctx.clientId)
    .maybeSingle();
  if (error) {
    console.error("[notification-prefs] read failed", error.message);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, prefs: sanitizePrefs(data?.notification_prefs) });
}

// Body: { changes: { morning_briefing: true, nudges: false, ... } } — merged onto the stored prefs so
// two quick toggles can't overwrite each other with a stale full copy.
export async function PUT(request: Request) {
  if (!sameOriginOk(request)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });

  const { userId, ctx } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  if (!ctx?.clientId) return NextResponse.json({ ok: false, reason: "not_provisioned" }, { status: 200 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const changes = sanitizePrefs((body as { changes?: unknown } | null)?.changes);
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ ok: false, reason: "no_valid_changes" }, { status: 400 });
  }

  const db = service();
  const { data: cur, error: readErr } = await db
    .from("client_profile")
    .select("notification_prefs")
    .eq("client_id", ctx.clientId)
    .maybeSingle();
  if (readErr) {
    console.error("[notification-prefs] read failed", readErr.message);
    return NextResponse.json({ ok: false, reason: "read_failed" }, { status: 502 });
  }
  const next = { ...sanitizePrefs(cur?.notification_prefs), ...changes };
  const { error } = await db.from("client_profile").update({ notification_prefs: next }).eq("client_id", ctx.clientId);
  if (error) {
    console.error("[notification-prefs] write failed", error.message);
    return NextResponse.json({ ok: false, reason: "write_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, prefs: next });
}
