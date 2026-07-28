import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { toE164 } from "@/lib/phone";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

// W1 — Write path: push the signed-in user's web profile into THEIR Airtable `tbl_client_profile`
// record (client + base resolved from their profile), so the n8n briefing/nudges use their data.
// The Airtable token stays server-side. An unprovisioned user has nowhere to write -> no-op.

const AIRTABLE_API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";

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

export async function POST(request: Request) {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });
  }
  const pat =
    process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT;

  // Must be signed in — this writes that user's own data.
  const { userId, ctx, profile } = await getClientContext();
  if (!userId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  // Tenant resolved from the user's profile — never a shared env var.
  const baseId = ctx?.baseId;
  const clientId = ctx?.clientId;
  if (!pat || !baseId || !clientId) {
    return NextResponse.json({ ok: false, reason: "not_provisioned" }, { status: 200 });
  }
  if (!profile) {
    return NextResponse.json({ ok: false, reason: "no_profile" }, { status: 200 });
  }

  // Build the Airtable field patch (only include fields that have a value).
  const fields: Record<string, string> = {};
  if (typeof profile.full_name === "string") fields.full_name = profile.full_name;
  const phone = toE164(profile.phone as string | undefined);
  if (phone) fields.phone_number = phone;
  if (isValidTimezone(profile.timezone)) fields.timezone = profile.timezone;
  if (typeof profile.primary_goal === "string") fields.top_priority_1 = profile.primary_goal;

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ ok: true, synced: [], note: "nothing to sync" });
  }

  // Find the client record id (by client_id), then PATCH it. Guarded to the pinned base only.
  const findUrl =
    `${AIRTABLE_API}/${baseId}/tbl_client_profile` +
    `?filterByFormula=${encodeURIComponent(`{client_id}='${clientId}'`)}&maxRecords=1`;
  const findRes = await fetchWithRetry(findUrl, {
    headers: { Authorization: `Bearer ${pat}` },
    cache: "no-store",
  });
  if (!findRes.ok) {
    return NextResponse.json(
      { ok: false, reason: "lookup_failed", status: findRes.status },
      { status: 502 }
    );
  }
  const found = (await findRes.json()) as { records: { id: string }[] };
  const recordId = found.records[0]?.id;
  if (!recordId) {
    return NextResponse.json({ ok: false, reason: "client_not_found" }, { status: 404 });
  }

  const patchRes = await fetchWithRetry(`${AIRTABLE_API}/${baseId}/tbl_client_profile/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!patchRes.ok) {
    // Log upstream detail SERVER-SIDE only — never return provider text (may contain PII) to the browser.
    const text = await patchRes.text();
    console.error(`[profile-sync] Airtable write failed ${patchRes.status}: ${text.slice(0, 300)}`);
    return NextResponse.json(
      {
        ok: false,
        reason: "write_failed",
        code:
          patchRes.status === 403
            ? "airtable_write_scope_missing"
            : "airtable_write_error",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, synced: Object.keys(fields), recordId });
}
