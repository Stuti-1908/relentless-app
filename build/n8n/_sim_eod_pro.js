/**
 * _sim_eod_pro.js — offline parity check for the Pro 6-pillar EoD wiring (Task #8).
 * Proves: (a) Standard path composite is unchanged (4-pillar); (b) Pro path uses the
 * 6-pillar compositePro with capital/risk from business_health; (c) neutral fallback (70)
 * when a Pro client has no business_health row yet.
 *
 * Run: node _sim_eod_pro.js   (asserts; prints OK or throws)
 */
'use strict';
const assert = require('assert');
const s = require('../harness/scoring/scoring');

// Mirrors the branch logic that goes into the patched computeScore node.
function computeComposite({ plan, body, focus, execution, alignment, businessHealth }) {
  if (plan === 'pro') {
    const bh = businessHealth || null;
    const capital = bh && bh.cash_position
      ? s.capitalScore(bh.capital_base != null ? bh.capital_base : null, bh.cash_position, bh.stage || 'growing')
      : 70; // neutral fallback when no weekly check-in data yet
    const risk = bh && (bh.severity != null || bh.manageability != null)
      ? s.riskScore({ severity: bh.severity || 0, manageability: bh.manageability != null ? bh.manageability : 100, stage: bh.stage || 'growing', deliberate: bh.deliberate || null })
      : 70; // neutral fallback
    const composite = s.compositePro({ body, focus, execution, alignment, capital, risk });
    return { composite, capital, risk, pillars: 6 };
  }
  const composite = s.compositeStandard({ body, focus, execution, alignment });
  return { composite, pillars: 4 };
}

// ---- Scenario A: Standard client — must equal the existing 4-pillar composite ----
const A = computeComposite({ plan: 'standard', body: 76, focus: 48, execution: 72, alignment: 100 });
assert.strictEqual(A.pillars, 4);
assert.strictEqual(A.composite, s.compositeStandard({ body: 76, focus: 48, execution: 72, alignment: 100 }));
console.log('A standard composite =', A.composite, '(label', s.scoreLabel(A.composite) + ')');

// ---- Scenario B: Pro client WITH business_health (healthy cash, low manageable risk) ----
const bhHealthy = { cash_position: 'on_track', capital_base: 70, severity: 20, manageability: 80, stage: 'growing' };
const B = computeComposite({ plan: 'pro', body: 76, focus: 48, execution: 72, alignment: 100, businessHealth: bhHealthy });
assert.strictEqual(B.pillars, 6);
assert.strictEqual(B.capital, s.capitalScore(70, 'on_track', 'growing')); // 70+15=85
assert.strictEqual(B.risk, s.riskScore({ severity: 20, manageability: 80, stage: 'growing' }));
assert.strictEqual(B.composite, s.compositePro({ body: 76, focus: 48, execution: 72, alignment: 100, capital: B.capital, risk: B.risk }));
console.log('B pro composite =', B.composite, 'capital', B.capital, 'risk', B.risk, '(label', s.scoreLabel(B.composite) + ')');

// ---- Scenario C: Pro client WITHOUT business_health → neutral 70 capital + risk ----
const C = computeComposite({ plan: 'pro', body: 76, focus: 48, execution: 72, alignment: 100, businessHealth: null });
assert.strictEqual(C.capital, 70);
assert.strictEqual(C.risk, 70);
assert.strictEqual(C.composite, s.compositePro({ body: 76, focus: 48, execution: 72, alignment: 100, capital: 70, risk: 70 }));
console.log('C pro (no data) composite =', C.composite, '(neutral capital/risk 70)');

// ---- Scenario D: Pro client in trouble (critical cash, severe unmanageable risk) ----
const bhBad = { cash_position: 'critical', capital_base: 60, severity: 85, manageability: 25, stage: 'operating' };
const D = computeComposite({ plan: 'pro', body: 50, focus: 40, execution: 33, alignment: 90, businessHealth: bhBad });
assert.strictEqual(D.capital, s.capitalScore(60, 'critical', 'operating')); // 60-25=35
assert.ok(D.composite < B.composite, 'bad business health should lower composite');
console.log('D pro (critical) composite =', D.composite, 'capital', D.capital, 'risk', D.risk, '(label', s.scoreLabel(D.composite) + ')');

console.log('\n_sim_eod_pro.js: all assertions passed');
