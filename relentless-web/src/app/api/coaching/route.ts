import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { createClient } from "@supabase/supabase-js";

// Server-only: reads the SIGNED-IN USER'S coaching data from Supabase, keyed by their
// client_id. An unprovisioned user (no client_id) gets no data.
//
// Was Airtable-backed until 2026-08-11. The n8n workflow migration (2026-08-06) moved every
// automation off Airtable's exhausted API billing quota, but this route was missed entirely -
// it kept calling the same dead tbl_* endpoints, which is why the dashboard (score trend,
// market signals, monthly report, business health) stayed static/empty even after the
// workflows were fixed and writing real data to Supabase. See HANDOFF-2026-08-06.md and
// HANDOFF-2026-08-10-antigravity.md for the wider migration history.
//
// Uses the service role key: this route already runs server-side only and the values
// returned are scoped to the signed-in user's own client_id, same trust boundary the old
// Airtable PAT had.

type Json = Record<string, unknown>;

// Per-client cache + single-flight, same shape as the Airtable version had.
const CACHE_TTL_MS = 60_000;
const cacheByKey = new Map<string, { at: number; body: Json }>();
const inflightByKey = new Map<string, Promise<Json>>();

function supa() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

export async function GET() {
  // Only signed-in users (401 JSON, not a redirect).
  const { userId, ctx } = await getClientContext();
  if (!userId) {
    return NextResponse.json({ configured: false, reason: "unauthenticated" }, { status: 401 });
  }
  // Unprovisioned user — no client assigned yet. Show NOTHING (never fall back to another client).
  const clientId = ctx?.clientId ?? null;
  if (!clientId) {
    return NextResponse.json({ configured: false, reason: "not_provisioned" });
  }

  const key = clientId;
  // Serve from this client's cache when fresh. `plan` is per-user, so merge it in fresh.
  // Plan: prefer the authoritative plan from the client's profile (set in the cached body),
  // falling back to the per-user context plan, then "standard".
  const resolvePlan = (body: Json): string =>
    (typeof body.plan === "string" && body.plan) || ctx?.plan || "standard";

  const cached = cacheByKey.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.body, cached: true, plan: resolvePlan(cached.body) });
  }

  // Coalesce concurrent misses for the SAME key into one upstream fetch.
  let inflight = inflightByKey.get(key);
  if (!inflight) {
    inflight = loadFresh(clientId, key).finally(() => inflightByKey.delete(key));
    inflightByKey.set(key, inflight);
  }
  const body = await inflight;
  return NextResponse.json({ ...body, plan: resolvePlan(body) });
}

type Activity = { title: string; detail?: string; at: string | null; kind: string };

// Reads + shapes coaching data for one client. One call at a time per key.
async function loadFresh(clientId: string, key: string): Promise<Json> {
  const sb = supa();
  const result: Json = { configured: true };
  const errors: string[] = [];

  // All reads fire concurrently (~1 round-trip). Every query is filtered by client_id so no
  // client ever sees another's rows — RLS is bypassed by the service key, so this filter is
  // the only thing enforcing that boundary here.
  const [scoresR, bioR, briefR, nudgesR, fbR, profR, healthR, mktR, monthR] = await Promise.allSettled([
    sb.from("daily_scores").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(90),
    sb.from("biometrics").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(7),
    sb.from("briefings").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(3),
    sb.from("nudges").select("*").eq("client_id", clientId).order("timestamp", { ascending: false }).limit(10),
    // "feedback" has no Supabase table and never had one in Airtable either — no n8n workflow
    // has ever written to it. Kept in the Promise.allSettled slot (rather than removed) so the
    // fbR index below still lines up; it always rejects and is treated as non-fatal, same as
    // the other "table may legitimately be absent" cases in this file.
    sb.from("feedback").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(10),
    sb.from("v_clients").select("*").eq("client_id", clientId).limit(1),
    sb.from("business_health").select("*").eq("client_id", clientId).order("week_start_date", { ascending: false }).limit(1),
    sb.from("market_signals").select("*").eq("client_id", clientId).order("date", { ascending: false }).limit(5),
    sb.from("monthly_reports").select("*").eq("client_id", clientId).order("month_year", { ascending: false }).limit(1),
  ]);

  const activity: Activity[] = [];
  const rowsOf = (r: PromiseSettledResult<{ data: Json[] | null; error: unknown }>): Json[] =>
    r.status === "fulfilled" && !r.value.error && r.value.data ? r.value.data : [];
  const errOf = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, label: string) => {
    if (r.status === "rejected") errors.push(`${label}: ${String(r.reason)}`);
    else if (r.value.error) errors.push(`${label}: ${String(r.value.error)}`);
  };

  // Latest daily score (+ up to 90 for the trend) + recent scores into the activity feed.
  const scoreRows = rowsOf(scoresR);
  if (scoresR.status === "fulfilled" && !scoresR.value.error) {
    const latest = scoreRows[0];
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
    result.trend = scoreRows
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
    scoreRows.slice(0, 5).forEach((f) => {
      const c = num(f.composite_score);
      if (c != null)
        activity.push({ kind: "score", title: `Evening score ${c}${str(f.score_label) ? ` — ${str(f.score_label)}` : ""}`, at: str(f.date) });
    });

    // Compute Weekly Averages & WoW Deltas
    const thisWeek = scoreRows.slice(0, 7);
    const lastWeek = scoreRows.slice(7, 14);
    const meanPillar = (list: Json[], k: string): number | null => {
      const vals = list.map((r) => num(r[k])).filter((v): v is number => v !== null);
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
  }
  errOf(scoresR, "daily_scores");

  // Biometrics: latest for the KPI; recent into activity.
  const bioRows = rowsOf(bioR);
  if (bioR.status === "fulfilled" && !bioR.value.error) {
    const f = bioRows[0];
    if (f) {
      result.biometrics = {
        recovery: num(f.recovery_score),
        hrv: num(f.hrv_score),
        sleep: num(f.sleep_score),
        source: str(f.source),
        date: str(f.date),
      };
    }
    bioRows.slice(0, 5).forEach((b) => {
      const rec = num(b.recovery_score);
      if (rec != null)
        activity.push({ kind: "biometric", title: `Recovery check-in: ${rec}`, detail: str(b.source) ?? undefined, at: str(b.date) });
    });
  }
  errOf(bioR, "biometrics");

  // Latest morning briefing (+ activity event).
  const briefRows = rowsOf(briefR);
  if (briefR.status === "fulfilled" && !briefR.value.error) {
    const parsedBriefings = briefRows.map((f) => {
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
  }
  errOf(briefR, "briefings");

  // Nudges → activity (sent / replied). Non-fatal if empty — a client may have none yet.
  rowsOf(nudgesR).forEach((f) => {
    activity.push({
      kind: "nudge",
      title: f.responded ? "Nudge replied" : "Nudge sent",
      detail: str(f.nudge_content) ?? undefined,
      at: str(f.timestamp),
    });
  });

  // Feedback → activity.
  rowsOf(fbR).forEach((f) => {
    activity.push({
      kind: "feedback",
      title: `Feedback on ${str(f.type) ?? "coaching"}: ${f.helpful ? "👍 helpful" : "👎 not helpful"}`,
      at: str(f.date),
    });
  });

  // Client profile (v_clients — joins profiles + client_profile) → stage intelligence + greeting.
  const profRows = rowsOf(profR);
  if (profR.status === "fulfilled" && !profR.value.error) {
    const f = profRows[0];
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
  }
  errOf(profR, "v_clients");

  // Business health (Pro) → stage intelligence detail. Non-fatal if absent for standard clients.
  const healthF = rowsOf(healthR)[0];
  if (healthF) {
    result.health = {
      cash: str(healthF.cash_position),
      team: str(healthF.team_health),
      biggestRisk: str(healthF.biggest_risk),
      avoidedDecision: str(healthF.avoided_decision),
      analysis: str(healthF.claude_analysis),
      capital: num(healthF.capital_score),
      risk: num(healthF.risk_score),
      weekStart: str(healthF.week_start_date),
    };
  }

  // Latest market signal(s) (Pro) → market intel card. Non-fatal if absent.
  const parsedSignals = rowsOf(mktR)
    .map((f) => ({ text: str(f.signal_text), source: str(f.source), date: str(f.date) }))
    .filter((s) => s.text);
  result.marketSignals = parsedSignals;
  result.marketSignal = parsedSignals[0] || null;

  // Latest monthly report → monthly report card. Non-fatal if absent.
  const monthF = rowsOf(monthR)[0];
  if (monthF) {
    result.monthly = {
      monthYear: str(monthF.month_year),
      score: num(monthF.monthly_score),
      baseScore: num(monthF.base_score),
      trendBonus: num(monthF.trend_bonus),
      consistencyBonus: num(monthF.consistency_bonus),
      pillarBonus: num(monthF.pillar_improvement_bonus),
      bodyAvg: num(monthF.body_avg),
      focusAvg: num(monthF.focus_avg),
      executionAvg: num(monthF.execution_avg),
      alignmentAvg: num(monthF.alignment_avg),
      capitalAvg: num(monthF.capital_avg),
      riskAvg: num(monthF.risk_avg),
      peakDays: num(monthF.peak_days),
      recoveryDays: num(monthF.recovery_days),
      priorityCompletionRate: num(monthF.priority_completion_rate),
      bestDay: str(monthF.best_day_date),
      worstDay: str(monthF.worst_day_date),
    };
  }

  // Sort the merged activity feed newest-first, keep the most recent 8.
  result.activity = activity
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);

  if (errors.length) result.errors = errors;
  // Cache only fully-successful core reads, keyed by client_id (never cross-tenant).
  if (!errors.length) cacheByKey.set(key, { at: Date.now(), body: result });
  return result;
}
