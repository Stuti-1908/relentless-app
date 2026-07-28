import { NextResponse } from "next/server";
import { sameOriginOk } from "@/lib/csrf";

// Public lead-capture for the SMB Growth Diagnostic. Writes the lead + their result to Airtable
// tbl_leads. No auth (it's a top-of-funnel quiz) but same-origin guarded; the Airtable token
// stays server-side. The diagnosis itself is computed client-side from src/lib/diagnostic.ts.

const AIRTABLE_API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appjnWxg9sB3PV7Da";

const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max);

export async function POST(req: Request) {
  if (!sameOriginOk(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const pat = process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT;
  if (!pat) return NextResponse.json({ error: "not configured" }, { status: 500 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const email = str(body.email, 200).trim();
  const phone = str(body.phone, 60).trim();
  if (!email && !phone) {
    return NextResponse.json({ error: "email or phone required" }, { status: 400 });
  }

  const fields: Record<string, unknown> = {
    name: str(body.name, 200),
    email,
    phone,
    business_type: str(body.businessType, 200),
    total_score: typeof body.totalScore === "number" ? body.totalScore : null,
    top_constraint: str(body.topConstraint, 300),
    answers_json: str(body.answersJson, 4000),
    diagnosis: str(body.diagnosis, 4000),
    source: "diagnostic_quiz",
    created_at: new Date().toISOString(),
    status: "new",
  };

  try {
    const r = await fetch(`${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent("tbl_leads")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("lead write failed:", r.status, txt.slice(0, 300));
      return NextResponse.json({ ok: false, error: "could not save" }, { status: 502 });
    }
    const d = (await r.json()) as { id?: string };
    return NextResponse.json({ ok: true, id: d.id ?? null });
  } catch (e) {
    console.error("lead write error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "could not save" }, { status: 502 });
  }
}
