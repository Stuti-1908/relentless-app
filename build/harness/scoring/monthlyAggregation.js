/**
 * Relentless AI — Monthly report aggregation (Phase 6, god plan §5 / spec §6).
 *
 * Turns a month of tbl_daily_scores rows into the inputs monthlyScore() needs (base + the three
 * bonuses) plus the descriptive stats the report narrates. Pure logic; the n8n WF6 does the
 * Airtable read + Claude write. The exact bonus FORMULAS are under-specified in the plan (only
 * ranges + inputs are given), so they are pinned here deterministically:
 *
 * PINNED DECISIONS:
 *   M1. base_score = mean of composite_score over the month, rounded half-up.
 *   M2. trend_bonus (0-5): (secondHalfAvg − firstHalfAvg) composite points, 1 bonus pt per +2 pts
 *       of improvement, floored at 0, capped at 5. Declining months earn 0 (never negative).
 *   M3. consistency_bonus (0-3): by composite std-dev — <=5→3, <=10→2, <=15→1, else 0. Tighter
 *       day-to-day spread = more consistent execution.
 *   M4. pillar_improvement_bonus (0-4): count of the 4 Standard pillars (body/focus/execution/
 *       alignment) whose monthly average beat the PRIOR month's average, 1 pt each. No prior
 *       month → 0.
 *   M5. peak_days = composite>=90; recovery_days = composite<45 (matches scoreLabel bands).
 *   M6. priority_completion_rate = mean(execution_score)/100 (proxy; execution encodes priority match).
 *   M7. Pro: capital_avg / risk_avg = mean of those pillar columns when present (else null).
 */

'use strict';

function _num(v) { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function _mean(arr) { const v = arr.filter(x => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function _round(x) { return Math.round(x); }
function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function _std(arr) {
  const v = arr.filter(x => x !== null);
  if (v.length < 2) return 0;
  const m = _mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
}

// rows: this month's tbl_daily_scores (each has composite_score + pillar scores + date).
// priorRows: prior month's rows (for M4). opts.plan === 'pro' adds capital/risk averages.
function aggregateMonth(rows, priorRows = [], opts = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const comps = list.map(r => _num(r.composite_score)).filter(x => x !== null);

  if (!comps.length) {
    return { hasData: false, base_score: null, trend_bonus: 0, consistency_bonus: 0,
             pillar_improvement_bonus: 0, days: 0 };
  }

  const base_score = _round(_mean(comps));

  // M2 trend
  const mid = Math.floor(comps.length / 2);
  const firstHalf = comps.slice(0, mid || 1);
  const secondHalf = comps.slice(mid);
  const trendDelta = (_mean(secondHalf) || 0) - (_mean(firstHalf) || 0);
  const trend_bonus = _clamp(Math.floor(Math.max(0, trendDelta) / 2), 0, 5);

  // M3 consistency
  const sd = _std(comps);
  const consistency_bonus = sd <= 5 ? 3 : sd <= 10 ? 2 : sd <= 15 ? 1 : 0;

  // M4 pillar improvement vs prior month
  const PILLARS = ['body_score', 'focus_score', 'execution_score', 'alignment_score'];
  let pillar_improvement_bonus = 0;
  const priorList = (Array.isArray(priorRows) ? priorRows : []).filter(Boolean);
  if (priorList.length) {
    for (const col of PILLARS) {
      const cur = _mean(list.map(r => _num(r[col])));
      const prev = _mean(priorList.map(r => _num(r[col])));
      if (cur !== null && prev !== null && cur > prev) pillar_improvement_bonus += 1;
    }
  }
  pillar_improvement_bonus = _clamp(pillar_improvement_bonus, 0, 4);

  // M5/M6 descriptive stats
  const peak_days = comps.filter(c => c >= 90).length;
  const recovery_days = comps.filter(c => c < 45).length;
  const execMean = _mean(list.map(r => _num(r.execution_score)));
  const priority_completion_rate = execMean !== null ? Math.round((execMean / 100) * 100) / 100 : null;

  let best = null, worst = null;
  for (const r of list) {
    const c = _num(r.composite_score); if (c === null) continue;
    if (!best || c > _num(best.composite_score)) best = r;
    if (!worst || c < _num(worst.composite_score)) worst = r;
  }

  const out = {
    hasData: true,
    days: list.length,
    base_score,
    trend_bonus, consistency_bonus, pillar_improvement_bonus,
    composite_avg: base_score,
    peak_days, recovery_days,
    priority_completion_rate,
    best_day: best ? { date: best.date, composite: _num(best.composite_score) } : null,
    worst_day: worst ? { date: worst.date, composite: _num(worst.composite_score) } : null,
    std_dev: Math.round(sd * 10) / 10,
  };

  // M7 Pro averages
  if (String(opts.plan || '').toLowerCase() === 'pro') {
    out.capital_avg = (() => { const m = _mean(list.map(r => _num(r.capital_score))); return m === null ? null : _round(m); })();
    out.risk_avg = (() => { const m = _mean(list.map(r => _num(r.risk_score))); return m === null ? null : _round(m); })();
  }

  return out;
}

module.exports = { aggregateMonth };
