/* Monthly aggregation tests — run: node monthlyAggregation.test.js */
'use strict';
const assert = require('assert');
const { aggregateMonth } = require('./monthlyAggregation');
const { monthlyScore } = require('./scoring');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL:', name); throw e; } }

const day = (date, composite, extra = {}) => Object.assign({ date, composite_score: composite }, extra);

t('empty -> hasData false', () => {
  const r = aggregateMonth([]);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.base_score, null);
});

t('base_score is the mean', () => {
  const rows = [day('2026-05-01', 70), day('2026-05-02', 80), day('2026-05-03', 90)];
  assert.strictEqual(aggregateMonth(rows).base_score, 80);
});

t('trend_bonus rewards improvement', () => {
  // first half ~60, second half ~80 → +20 → /2 = 10 capped at 5
  const rows = [day('2026-05-01', 60), day('2026-05-02', 60), day('2026-05-03', 80), day('2026-05-04', 80)];
  assert.strictEqual(aggregateMonth(rows).trend_bonus, 5);
});

t('trend_bonus small improvement', () => {
  // first half 70, second half 74 → +4 → /2 = 2
  const rows = [day('2026-05-01', 70), day('2026-05-02', 70), day('2026-05-03', 74), day('2026-05-04', 74)];
  assert.strictEqual(aggregateMonth(rows).trend_bonus, 2);
});

t('trend_bonus declining month -> 0 (never negative)', () => {
  const rows = [day('2026-05-01', 90), day('2026-05-02', 90), day('2026-05-03', 60), day('2026-05-04', 60)];
  assert.strictEqual(aggregateMonth(rows).trend_bonus, 0);
});

t('consistency_bonus high when tight', () => {
  const rows = [day('2026-05-01', 78), day('2026-05-02', 80), day('2026-05-03', 79), day('2026-05-04', 81)];
  assert.strictEqual(aggregateMonth(rows).consistency_bonus, 3); // sd <= 5
});

t('consistency_bonus low when scattered', () => {
  const rows = [day('2026-05-01', 30), day('2026-05-02', 95), day('2026-05-03', 40), day('2026-05-04', 90)];
  assert.strictEqual(aggregateMonth(rows).consistency_bonus, 0); // sd > 15
});

t('pillar_improvement_bonus counts improved pillars', () => {
  const prior = [day('2026-04-01', 70, { body_score: 60, focus_score: 60, execution_score: 60, alignment_score: 100 })];
  const cur = [day('2026-05-01', 75, { body_score: 70, focus_score: 65, execution_score: 60, alignment_score: 100 })];
  // body up, focus up, execution equal (not >), alignment equal -> 2
  assert.strictEqual(aggregateMonth(cur, prior).pillar_improvement_bonus, 2);
});

t('pillar_improvement_bonus 0 without prior month', () => {
  const cur = [day('2026-05-01', 75, { body_score: 70, focus_score: 65, execution_score: 60, alignment_score: 100 })];
  assert.strictEqual(aggregateMonth(cur, []).pillar_improvement_bonus, 0);
});

t('peak and recovery day counts', () => {
  const rows = [day('2026-05-01', 92), day('2026-05-02', 40), day('2026-05-03', 95), day('2026-05-04', 70)];
  const r = aggregateMonth(rows);
  assert.strictEqual(r.peak_days, 2);
  assert.strictEqual(r.recovery_days, 1);
});

t('best and worst day', () => {
  const rows = [day('2026-05-01', 70), day('2026-05-02', 95), day('2026-05-03', 40)];
  const r = aggregateMonth(rows);
  assert.strictEqual(r.best_day.date, '2026-05-02');
  assert.strictEqual(r.worst_day.date, '2026-05-03');
});

t('priority_completion_rate from execution mean', () => {
  const rows = [day('2026-05-01', 70, { execution_score: 66 }), day('2026-05-02', 70, { execution_score: 99 })];
  // mean exec 82.5 -> 0.825 -> rounded 0.83 (wait: (66+99)/2=82.5 -> /100=0.825 -> round2=0.83)
  assert.strictEqual(aggregateMonth(rows).priority_completion_rate, 0.83);
});

t('pro adds capital/risk averages', () => {
  const rows = [day('2026-05-01', 80, { capital_score: 80, risk_score: 70 }), day('2026-05-02', 80, { capital_score: 90, risk_score: 80 })];
  const r = aggregateMonth(rows, [], { plan: 'pro' });
  assert.strictEqual(r.capital_avg, 85);
  assert.strictEqual(r.risk_avg, 75);
});

t('standard omits capital/risk', () => {
  const rows = [day('2026-05-01', 80, { capital_score: 80 })];
  const r = aggregateMonth(rows, [], { plan: 'standard' });
  assert.strictEqual(r.capital_avg, undefined);
});

t('feeds monthlyScore() within range', () => {
  const rows = [day('2026-05-01', 60), day('2026-05-02', 60), day('2026-05-03', 80), day('2026-05-04', 82)];
  const a = aggregateMonth(rows);
  const final = monthlyScore(a.base_score, a.trend_bonus, a.consistency_bonus, a.pillar_improvement_bonus);
  assert.ok(final >= 0 && final <= 100);
  assert.ok(final >= a.base_score); // bonuses only add
});

console.log('monthlyAggregation.test.js: ' + passed + ' assertions passed');
