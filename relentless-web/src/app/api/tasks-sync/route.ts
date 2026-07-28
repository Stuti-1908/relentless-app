import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

// W2 — Write path: mirror web to-dos into GoHighLevel tasks on THE USER'S contact (resolved from
// their profile), so completing them moves the real Execution pillar + feeds the nudge engine.
// GHL token stays server-side. Non-fatal: the dashboard never blocks on this.

const GHL_API = process.env.GHL_API_URL || "https://services.leadconnectorhq.com";

type Body = {
  op: "create" | "complete" | "delete";
  title?: string;
  dueDate?: string | null;
  ghlTaskId?: string;
  completed?: boolean;
};

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// GHL tasks require a dueDate. Date-only values are set to 23:00 UTC so they still read as that day
// across US timezones without needing per-user timezone math here.
function dueDateISO(date?: string | null) {
  const d = date ? new Date(`${date}T23:00:00Z`) : new Date();
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setUTCHours(23, 0, 0, 0);
    return fallback.toISOString();
  }
  d.setUTCHours(23, 0, 0, 0);
  return d.toISOString();
}

export async function POST(request: Request) {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  }
  const token = process.env.GHL_TOKEN;

  // Must be signed in (writes on the user's behalf).
  const { userId, ctx } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  // GHL contact resolved from the user's profile — never a shared env var.
  const contactId = ctx?.ghlContactId;
  if (!token || !contactId) {
    // Unprovisioned (or GHL not wired): tasks still work in Supabase, just no GHL mirror.
    return NextResponse.json({ ok: false, reason: "not_provisioned" });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }

  try {
    if (body.op === "create") {
      if (!body.title?.trim()) return NextResponse.json({ ok: false, reason: "no_title" }, { status: 400 });
      const res = await fetchWithRetry(`${GHL_API}/contacts/${contactId}/tasks`, {
        method: "POST",
        headers: ghlHeaders(token),
        body: JSON.stringify({
          title: body.title.trim(),
          body: "Added from the Relentless AI web app.",
          dueDate: dueDateISO(body.dueDate),
          completed: false,
        }),
      });
      if (!res.ok) return NextResponse.json({ ok: false, reason: "ghl_create_failed", status: res.status }, { status: 502 });
      const data = (await res.json()) as { task?: { id?: string }; id?: string };
      const ghlTaskId = data.task?.id ?? data.id ?? null;
      return NextResponse.json({ ok: true, ghlTaskId });
    }

    if (body.op === "complete") {
      if (!body.ghlTaskId) return NextResponse.json({ ok: true, skipped: "no_ghl_id" });
      const res = await fetchWithRetry(`${GHL_API}/contacts/${contactId}/tasks/${body.ghlTaskId}`, {
        method: "PUT",
        headers: ghlHeaders(token),
        body: JSON.stringify({ completed: body.completed ?? true }),
      });
      if (!res.ok) return NextResponse.json({ ok: false, reason: "ghl_update_failed", status: res.status }, { status: 502 });
      return NextResponse.json({ ok: true });
    }

    if (body.op === "delete") {
      if (!body.ghlTaskId) return NextResponse.json({ ok: true, skipped: "no_ghl_id" });
      const res = await fetchWithRetry(`${GHL_API}/contacts/${contactId}/tasks/${body.ghlTaskId}`, {
        method: "DELETE",
        headers: ghlHeaders(token),
      });
      if (!res.ok && res.status !== 404)
        return NextResponse.json({ ok: false, reason: "ghl_delete_failed", status: res.status }, { status: 502 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "unknown_op" }, { status: 400 });
  } catch (e) {
    // Log server-side only — never return raw exception text to the browser.
    console.error(`[tasks-sync] exception: ${String(e instanceof Error ? e.message : e)}`);
    return NextResponse.json({ ok: false, reason: "exception" }, { status: 502 });
  }
}
