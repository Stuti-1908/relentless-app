/**
 * Relentless AI — Scoring module (single source of truth for ALL score math).
 *
 * Plan refs: §5.0.8 (pure functions, no inline arithmetic in workflow nodes) and
 * §5.0.9 (pinned edge rules). Spec ref: §6 Phase 2 + §9 (manual conversion).
 *
 * USAGE IN n8n: paste this whole file into a Code node named "scoring" at the top of
 * WF2/WF6/WF7, or load it as an external module. NEVER re-derive these formulas inline.
 *
 * PINNED DECISIONS (spec was ambiguous — confirm with client, tracked as open questions):
 *   P1. Body value WITHIN a band = linear interpolation (plan §5.0.9).
 *   P2. Focus: when nudges_sent==0, NRR defaults to 0.70; when focus_blocks_total==0,
 *       FBP defaults to 0.70 (mirrors the one stated default "no nudges -> 70").
 *   P3. Execution bonus = min(10, extraTasks) (1 pt per extra completed task, cap 10).
 *   P4. Capital/Risk are clamped to [0,100] AFTER stage adjustment (plan §5.0.9).
 *   P5. All pillar outputs and composites are rounded half-up to integers.
 *   P6. Risk severity & manageability are 0-100 numbers produced by Claude from the
 *       weekly check-in text (the spec collects text, the formula needs numbers).
 */

'use strict';

// ---------- primitives ----------
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function roundHalfUp(x) { return Math.round(x); } // JS rounds .5 up for positive values

// ---------- BODY (band interpolation, plan §5.0.9) ----------
// bands: [recoveryLow, recoveryHigh, bodyLow, bodyHigh]
const BODY_BANDS = [
  [85, 100, 90, 100],
  [70, 84, 75, 89],
  [50, 69, 50, 74],
  [0, 49, 0, 49],
];
const BODY_DEFAULT_NO_DATA = 60;

function bodyScore(recovery, hasData = true) {
  if (!hasData || recovery == null) return BODY_DEFAULT_NO_DATA; // biometric_missing=true
  const r = clamp(recovery, 0, 100);
  for (const [rl, rh, bl, bh] of BODY_BANDS) {
    if (r >= rl && r <= rh) {
      const span = rh - rl || 1;
      return roundHalfUp(bl + ((r - rl) / span) * (bh - bl));
    }
  }
  return BODY_DEFAULT_NO_DATA;
}

// ---------- FOCUS ----------
// Focus = NRR*50 + FBP*50, NRR/FBP in [0,1]. (P2 defaults when denominators are 0.)
function focusScore({ nudges_sent = 0, nudges_responded = 0,
                      focus_blocks_total = 0, focus_blocks_protected = 0 } = {}) {
  const nrr = nudges_sent > 0 ? clamp(nudges_responded / nudges_sent, 0, 1) : 0.70;
  const fbp = focus_blocks_total > 0 ? clamp(focus_blocks_protected / focus_blocks_total, 0, 1) : 0.70;
  return roundHalfUp(nrr * 50 + fbp * 50);
}

// ---------- EXECUTION ----------
// each matched priority = 33.3 pts; +min(10, extraTasks) bonus; cap 100.
function executionScore(matchedPriorities = 0, extraTasks = 0) {
  const base = clamp(matchedPriorities, 0, 3) * 33.3;
  const bonus = clamp(extraTasks, 0, 10);
  return roundHalfUp(clamp(base + bonus, 0, 100));
}

// ---------- ALIGNMENT ----------
// baseline 100; -5 per focus block interrupted by an unplanned meeting; floor 0.
function alignmentScore(interruptions = 0) {
  return roundHalfUp(clamp(100 - 5 * Math.max(0, interruptions), 0, 100));
}

// ---------- CAPITAL (Pro) — additive stage matrix, clamp [0,100] ----------
const CAPITAL_DELTA = {
  on_track: { launching: 10, growing: 15, operating: 15 },
  tight:    { launching: 5,  growing: 0,  operating: 0 },
  critical: { launching: -10, growing: -20, operating: -25 },
};
const CAPITAL_DEFAULT = 70;

function capitalScore(base, cashPosition, stage) {
  const b = (base == null) ? CAPITAL_DEFAULT : base;
  const delta = (CAPITAL_DELTA[cashPosition] && CAPITAL_DELTA[cashPosition][stage]) || 0;
  return roundHalfUp(clamp(b + delta, 0, 100)); // P4 clamp
}

// ---------- RISK (Pro) — severity/manageability formula, clamp [0,100] ----------
// severity, manageability in [0,100] (P6: produced by Claude from the check-in text).
function riskScore({ severity = 0, manageability = 100, stage = 'growing', deliberate = null } = {}) {
  const sev = clamp(severity, 0, 100);
  const unman = 100 - clamp(manageability, 0, 100);
  let wSev, wUnman;
  if (stage === 'launching' && deliberate === 'deliberate') { wSev = 0.3; wUnman = 0.7; }
  else if (stage === 'launching' && deliberate === 'unexpected') { wSev = 0.7; wUnman = 0.3; }
  else { wSev = 0.5; wUnman = 0.5; } // growing / operating (and launching w/o flag)
  return roundHalfUp(clamp(100 - (sev * wSev + unman * wUnman), 0, 100)); // P4 clamp
}

// ---------- COMPOSITES ----------
function compositeStandard({ body, focus, execution, alignment }) {
  return roundHalfUp(body * 0.25 + focus * 0.25 + execution * 0.30 + alignment * 0.20);
}
function compositePro({ body, focus, execution, alignment, capital, risk }) {
  return roundHalfUp(
    body * 0.20 + focus * 0.20 + execution * 0.25 + alignment * 0.15 +
    capital * 0.15 + risk * 0.10
  );
}

// ---------- LABEL ----------
function scoreLabel(composite) {
  if (composite >= 90) return 'Peak';
  if (composite >= 75) return 'Strong';
  if (composite >= 60) return 'Steady';
  if (composite >= 45) return 'Below Par';
  return 'Recovery Day';
}

// ---------- MANUAL BIOMETRIC CONVERSION (§9) ----------
// sleep/energy/stress are 1-5 self-reports.
function manualRecovery(sleep, energy, stress) {
  const sleepEq = clamp(sleep, 1, 5) * 14;          // 14..70
  const energyRec = clamp(energy, 1, 5) * 18;        // 18..90
  const stressAdj = (6 - clamp(stress, 1, 5)) * 8;   // 8..40, inverted
  return roundHalfUp(Math.min(100, (sleepEq + energyRec + stressAdj) / 2.0));
}

// ---------- MONTHLY ----------
// bonuses clamped to their stated ranges; total clamped [0,100].
function monthlyScore(baseScore, trendBonus = 0, consistencyBonus = 0, pillarImprovementBonus = 0) {
  const t = clamp(trendBonus, 0, 5);
  const c = clamp(consistencyBonus, 0, 3);
  const p = clamp(pillarImprovementBonus, 0, 4);
  return roundHalfUp(clamp(baseScore + t + c + p, 0, 100));
}

module.exports = {
  clamp, roundHalfUp,
  bodyScore, focusScore, executionScore, alignmentScore,
  capitalScore, riskScore,
  compositeStandard, compositePro, scoreLabel,
  manualRecovery, monthlyScore,
  BODY_BANDS, CAPITAL_DELTA,
};
