import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";

// Server-only: reads the SIGNED-IN USER'S client coaching data from THEIR Airtable base (resolved
// from their profile, never a shared env var). An unprovisioned user (no base) gets no data.
// The Airtable token NEVER reaches the browser — it stays in this server route.

const AIRTABLE_API = process.env.AIRTABLE_API_URL || "https://api.airtable.com/v0";

type Json = Record<string, unknown>;

// Per-(base+client) cache + single-flight. A base can hold more than one client row (e.g. the test
// base has client_test + demo_pro), so the client_id is part of the key — one user can NEVER be
// served another client's cached data.
const CACHE_TTL_MS = 60_000;
const cacheByKey = new Map<string, { at: number; body: Json }>();
const inflightByKey = new Map<string, Promise<Json>>();

async function airtable(baseId: string, table: string, query: string, pat: string) {
  const res = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}?${query}`, {
    headers: { Authorization: `Bearer ${pat}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${table} → HTTP ${res.status}`);
  return (await res.json()) as { records: { id: string; fields: Json }[] };
}

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

// Build an Airtable list query: optional desc-sort by a field, optional client_id filter, max rows.
function listQuery(opts: { sort?: string; client?: string | null; max?: number }): string {
  const parts: string[] = [];
  if (opts.sort) {
    parts.push(`sort%5B0%5D%5Bfield%5D=${encodeURIComponent(opts.sort)}`);
    parts.push("sort%5B0%5D%5Bdirection%5D=desc");
  }
  if (opts.client) {
    const safe = opts.client.replace(/'/g, "");
    parts.push(`filterByFormula=${encodeURIComponent(`{client_id}='${safe}'`)}`);
  }
  if (opts.max) parts.push(`maxRecords=${opts.max}`);
  return parts.join("&");
}

export async function GET() {
  // Only signed-in users (401 JSON, not a redirect).
  const { userId, ctx } = await getClientContext();
  if (!userId) {
    return NextResponse.json({ configured: false, reason: "unauthenticated" }, { status: 401 });
  }
  // Unprovisioned user — no client assigned yet. Show NOTHING (never fall back to another base).
  const baseId = ctx?.baseId;
  const clientId = ctx?.clientId ?? null;
  if (!baseId) {
    return NextResponse.json({ configured: false, reason: "not_provisioned" });
  }

  const key = `${baseId}|${clientId ?? ""}`;
  // Serve from this (base+client)'s cache when fresh. `plan` is per-user, so merge it in fresh.
  // Plan: prefer the authoritative plan from the client's Airtable profile (set in the cached body),
  // falling back to the per-user Supabase plan, then "standard".
  const resolvePlan = (body: Json): string =>
    (typeof body.plan === "string" && body.plan) || ctx?.plan || "standard";

  const cached = cacheByKey.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.body, cached: true, plan: resolvePlan(cached.body) });
  }

  // Coalesce concurrent misses for the SAME key into one upstream fetch.
  let inflight = inflightByKey.get(key);
  if (!inflight) {
    inflight = loadFresh(baseId, clientId, key).finally(() => inflightByKey.delete(key));
    inflightByKey.set(key, inflight);
  }
  const body = await inflight;
  return NextResponse.json({ ...body, plan: resolvePlan(body) });
}

type Activity = { title: string; detail?: string; at: string | null; kind: string };

// Reads + shapes coaching data for one (base, client). One call at a time per key.
async function loadFresh(baseId: string, clientId: string | null, key: string): Promise<Json> {
  const pat = process.env.RELENTLESS_WEB_APP_AIRTABLE_TOKEN || process.env.AIRTABLE_PAT;
  if (!pat) {
    // Not wired yet — dashboard keeps its placeholder visuals.
    return { configured: false, reason: "no_token" };
  }

  const result: Json = { configured: true, baseId };
  const errors: string[] = [];

  // All reads fire concurrently (~1 round-trip). Per-client tables are filtered by client_id so a
  // multi-client base never bleeds rows across tenants.
  const [scoresR, bioR, briefR, nudgesR, fbR, profR, healthR, mktR, monthR] = await Promise.allSettled([
    airtable(baseId, "tbl_daily_scores", listQuery({ sort: "date", client: clientId, max: 90 }), pat),
    airtable(baseId, "tbl_biometrics", listQuery({ sort: "date", client: clientId, max: 7 }), pat),
    airtable(baseId, "tbl_briefings", listQuery({ sort: "date", client: clientId, max: 3 }), pat),
    airtable(baseId, "tbl_nudges", listQuery({ sort: "timestamp", client: clientId, max: 10 }), pat),
    airtable(baseId, "tbl_feedback", listQuery({ sort: "date", client: clientId, max: 10 }), pat),
    airtable(baseId, "tbl_client_profile", listQuery({ client: clientId, max: 1 }), pat),
    airtable(baseId, "tbl_business_health", listQuery({ sort: "week_start_date", client: clientId, max: 1 }), pat),
    airtable(baseId, "tbl_market_signals", listQuery({ sort: "date", client: clientId, max: 5 }), pat),
    airtable(baseId, "tbl_monthly_reports", listQuery({ sort: "month_year", client: clientId, max: 1 }), pat),
  ]);

  const activity: Activity[] = [];

  // Latest daily score (+ up to 30 for the trend) + recent scores into the activity feed.
  if (scoresR.status === "fulfilled") {
    const rows = scoresR.value.records.map((r) => r.fields);
    const latest = rows[0];
    if (latest) {
      result.score = {
        composite: num(latest.composite_score),
        label: str(latest.score_label),
        body: num(latest.body_score),
        focus: num(latest.focus_score),
        execution: num(latest.execution_score),
        alignment: num(latest.alignment_score),
        capital: num(latest.capital_score),
        risk: num(latest.risk_score),
        priorities_completed: num(latest.priorities_completed),
        date: str(latest.date),
      };
    }
    result.trend = rows
      .map((f) => ({
        date: str(f.date),
        composite: num(f.composite_score),
        label: str(f.score_label),
        body: num(f.body_score),
        focus: num(f.focus_score),
        execution: num(f.execution_score),
        alignment: num(f.alignment_score),
        capital: num(f.capital_score),
        risk: num(f.risk_score),
      }))
      .filter((d) => d.composite != null)
      .reverse();
    rows.slice(0, 5).forEach((f) => {
      const c = num(f.composite_score);
      if (c != null)
        activity.push({ kind: "score", title: `Evening score ${c}${str(f.score_label) ? ` — ${str(f.score_label)}` : ""}`, at: str(f.date) });
    });

    // Compute Weekly Averages & WoW Deltas
    const thisWeek = rows.slice(0, 7);
    const lastWeek = rows.slice(7, 14);
    const meanPillar = (list: Json[], key: string): number | null => {
      const vals = list.map((r) => num(r[key])).filter((v): v is number => v !== null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const pillars = ["composite_score", "body_score", "focus_score", "execution_score", "alignment_score", "capital_score", "risk_score"];
    const deltas: Record<string, { current: number | null; previous: number | null; change: number | null }> = {};
    pillars.forEach((p) => {
      const cur = meanPillar(thisWeek, p);
      const prev = meanPillar(lastWeek, p);
      const change = cur !== null && prev !== null ? cur - prev : null;
      const name = p.replace("_score", "");
      deltas[name] = { current: cur, previous: prev, change };
    });
    result.weeklyDeltas = deltas;
  } else errors.push(String(scoresR.reason));

  // Biometrics: latest for the KPI; recent into activity.
  if (bioR.status === "fulfilled") {
    const rows = bioR.value.records.map((r) => r.fields);
    const f = rows[0];
    if (f) {
      result.biometrics = {
        recovery: num(f.recovery_score),
        hrv: num(f.hrv_score),
        sleep: num(f.sleep_score),
        source: str(f.source),
        date: str(f.date),
      };
    }
    rows.slice(0, 5).forEach((b) => {
      const rec = num(b.recovery_score);
      if (rec != null)
        activity.push({ kind: "biometric", title: `Recovery check-in: ${rec}`, detail: str(b.source) ?? undefined, at: str(b.date) });
    });
  } else errors.push(String(bioR.reason));

  // Latest morning briefing (+ activity event).
  if (briefR.status === "fulfilled") {
    const records = briefR.value.records.map((r) => r.fields);
    const parsedBriefings = records.map((f) => {
      let parsedSections = null;
      try {
        if (typeof f.sections_json === "string" && f.sections_json.trim() !== "") {
          parsedSections = JSON.parse(f.sections_json);
        }
      } catch {}
      return {
        text: str(f.briefing_text),
        priorities: [f.top_priority_1, f.top_priority_2, f.top_priority_3].filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0
        ),
        deliveredAt: str(f.delivered_at),
        date: str(f.date),
        ...(parsedSections && { sections: parsedSections }),
      };
    });
    result.briefings = parsedBriefings;
    const firstBrief = parsedBriefings[0];
    result.briefing = firstBrief || null;
    if (firstBrief) {
      activity.push({ kind: "briefing", title: "Morning briefing delivered", at: firstBrief.deliveredAt ?? firstBrief.date });
    }
  } else errors.push(String(briefR.reason));

  // Nudges → activity (sent / replied).
  if (nudgesR.status === "fulfilled") {
    nudgesR.value.records.map((r) => r.fields).forEach((f) => {
      activity.push({
        kind: "nudge",
        title: f.responded ? "Nudge replied" : "Nudge sent",
        detail: str(f.nudge_content) ?? undefined,
        at: str(f.timestamp),
      });
    });
  } // nudges table may legitimately be absent for some clients — non-fatal

  // Feedback → activity.
  if (fbR.status === "fulfilled") {
    fbR.value.records.map((r) => r.fields).forEach((f) => {
      activity.push({
        kind: "feedback",
        title: `Feedback on ${str(f.type) ?? "coaching"}: ${f.helpful ? "👍 helpful" : "👎 not helpful"}`,
        at: str(f.date),
      });
    });
  }

  // Client profile → stage intelligence + greeting.
  if (profR.status === "fulfilled") {
    const f = profR.value.records[0]?.fields;
    if (f) {
      result.profile = {
        name: str(f.full_name),
        stage: str(f.business_stage),
        avoidance: str(f.current_avoidance_pattern),
        goal: str(f.twelve_month_goal),
      };
      // Authoritative plan from the client's coaching profile (same source the backend gates on).
      const aplan = str(f.plan);
      if (aplan) result.plan = aplan;
    }
  } else errors.push(String(profR.reason));

  // Business health (Pro) → stage intelligence detail.
  if (healthR.status === "fulfilled") {
    const f = healthR.value.records[0]?.fields;
    if (f) {
      result.health = {
        cash: str(f.cash_position),
        team: str(f.team_health),
        biggestRisk: str(f.biggest_risk),
        avoidedDecision: str(f.avoided_decision),
        analysis: str(f.claude_analysis),
        capital: num(f.capital_score),
        risk: num(f.risk_score),
        weekStart: str(f.week_start_date),
      };
    }
  } // health table may be absent for standard clients — non-fatal

  // Latest market signal (Pro) → market intel card.
  if (mktR.status === "fulfilled") {
    const records = mktR.value.records.map((r) => r.fields);
    const parsedSignals = records.map((f) => ({
      text: str(f.signal_text),
      source: str(f.source),
      date: str(f.date),
    })).filter((s) => s.text);
    result.marketSignals = parsedSignals;
    result.marketSignal = parsedSignals[0] || null;
  } // market signals table may be absent — non-fatal

  // Latest monthly report → monthly report card.
  if (monthR.status === "fulfilled") {
    const f = monthR.value.records[0]?.fields;
    if (f) {
      result.monthly = {
        monthYear: str(f.month_year),
        score: num(f.monthly_score),
        baseScore: num(f.base_score),
        trendBonus: num(f.trend_bonus),
        consistencyBonus: num(f.consistency_bonus),
        pillarBonus: num(f.pillar_improvement_bonus),
        bodyAvg: num(f.body_avg),
        focusAvg: num(f.focus_avg),
        executionAvg: num(f.execution_avg),
        alignmentAvg: num(f.alignment_avg),
        capitalAvg: num(f.capital_avg),
        riskAvg: num(f.risk_avg),
        peakDays: num(f.peak_days),
        recoveryDays: num(f.recovery_days),
        priorityCompletionRate: num(f.priority_completion_rate),
        bestDay: str(f.best_day_date),
        worstDay: str(f.worst_day_date),
      };
    }
  } // monthly reports table may be absent — non-fatal

  // Sort the merged activity feed newest-first, keep the most recent 8.
  result.activity = activity
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);

  if (errors.length) result.errors = errors;
  // Cache only fully-successful core reads, keyed by base+client (never cross-tenant).
  if (!errors.length) cacheByKey.set(key, { at: Date.now(), body: result });
  return result;
}
