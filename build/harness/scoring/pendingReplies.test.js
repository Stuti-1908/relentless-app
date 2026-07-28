/* Pending-replies matcher tests — run: node pendingReplies.test.js */
'use strict';
const assert = require('assert');
const pr = require('./pendingReplies');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL:', name); throw e; } }

const row = (o) => Object.assign({ status: 'open', client_id: 'c1' }, o);

// ---------- shape predicates ----------
t('isScaleNumber 3', () => assert.strictEqual(pr.isScaleNumber('3'), true));
t('isScaleNumber 6 false', () => assert.strictEqual(pr.isScaleNumber('6'), false));
t('isThreeScaleNumbers "4 3 2"', () => assert.strictEqual(pr.isThreeScaleNumbers('4 3 2'), true));
t('isThreeScaleNumbers "4 3" false', () => assert.strictEqual(pr.isThreeScaleNumbers('4 3'), false));

// ---------- answerShapeFits ----------
t('feedback accepts YES', () => assert.strictEqual(pr.answerShapeFits('score_feedback', 'yes'), true));
t('feedback rejects random', () => assert.strictEqual(pr.answerShapeFits('score_feedback', 'banana'), false));
t('stage accepts ON TRACK', () => assert.strictEqual(pr.answerShapeFits('stage_transition', 'on track'), true));
t('manual_biometric accepts 3 nums', () => assert.strictEqual(pr.answerShapeFits('manual_biometric', '4 3 2'), true));
t('nudge_reply accepts freetext', () => assert.strictEqual(pr.answerShapeFits('nudge_reply', 'shipped it'), true));

// ---------- Rank 1: sequence wins ----------
t('sequence beats single-shot when reply is a number', () => {
  const rows = [
    row({ id: 'bio', expected_type: 'manual_biometric', opened_at: '2026-06-17T06:00:00Z' }),
    row({ id: 'fb', expected_type: 'score_feedback', opened_at: '2026-06-17T07:00:00Z' }),
  ];
  const r = pr.matchReply(rows, '4 3 2', { client_id: 'c1' });
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.row.id, 'bio');
  assert.strictEqual(r.rank, 1);
});
t('earliest sequence resumed first', () => {
  const rows = [
    row({ id: 'late', expected_type: 'weekly_checkin', context_ref: '2', opened_at: '2026-06-17T08:00:00Z' }),
    row({ id: 'early', expected_type: 'weekly_checkin', context_ref: '1', opened_at: '2026-06-17T07:00:00Z' }),
  ];
  const r = pr.matchReply(rows, '3', { client_id: 'c1' });
  assert.strictEqual(r.row.id, 'early');
});

// ---------- Rank 2: single-shot, latest wins ----------
t('single-shot match, latest opened wins', () => {
  const rows = [
    row({ id: 'old', expected_type: 'briefing_feedback', opened_at: '2026-06-17T06:30:00Z' }),
    row({ id: 'new', expected_type: 'score_feedback', opened_at: '2026-06-17T19:30:00Z' }),
  ];
  const r = pr.matchReply(rows, 'YES', { client_id: 'c1' });
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.row.id, 'new');
  assert.strictEqual(r.rank, 2);
});

// ---------- Rank 3: free-text fallback ----------
t('freetext fallback when only nudge open', () => {
  const rows = [row({ id: 'n', expected_type: 'nudge_reply', opened_at: '2026-06-17T10:00:00Z' })];
  const r = pr.matchReply(rows, 'made progress today', { client_id: 'c1' });
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.rank, 3);
});
t('single-shot beats freetext for YES', () => {
  const rows = [
    row({ id: 'n', expected_type: 'nudge_reply', opened_at: '2026-06-17T10:00:00Z' }),
    row({ id: 'f', expected_type: 'score_feedback', opened_at: '2026-06-17T19:00:00Z' }),
  ];
  const r = pr.matchReply(rows, 'YES', { client_id: 'c1' });
  assert.strictEqual(r.row.id, 'f');
  assert.strictEqual(r.rank, 2);
});

// ---------- ties & no-match ----------
t('sequence tie -> unmatched', () => {
  const rows = [
    row({ id: 'a', expected_type: 'manual_biometric', opened_at: '2026-06-17T06:00:00Z' }),
    row({ id: 'b', expected_type: 'weekly_checkin', opened_at: '2026-06-17T06:00:00Z' }),
  ];
  const r = pr.matchReply(rows, '3', { client_id: 'c1' });
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.reason, 'ambiguous_sequence_tie');
});
t('no open rows -> unmatched', () => {
  assert.strictEqual(pr.matchReply([], 'YES', { client_id: 'c1' }).matched, false);
});
t('closed rows ignored', () => {
  const rows = [row({ id: 'x', expected_type: 'score_feedback', status: 'matched', opened_at: '2026-06-17T07:00:00Z' })];
  assert.strictEqual(pr.matchReply(rows, 'YES', { client_id: 'c1' }).matched, false);
});
t('other client rows ignored', () => {
  const rows = [row({ id: 'x', client_id: 'c2', expected_type: 'score_feedback', opened_at: '2026-06-17T07:00:00Z' })];
  assert.strictEqual(pr.matchReply(rows, 'YES', { client_id: 'c1' }).matched, false);
});
t('no shape fit -> unmatched', () => {
  const rows = [row({ id: 'f', expected_type: 'score_feedback', opened_at: '2026-06-17T07:00:00Z' })];
  const r = pr.matchReply(rows, 'lorem ipsum dolor', { client_id: 'c1' });
  assert.strictEqual(r.matched, false);
  assert.strictEqual(r.reason, 'no_shape_fit');
});

// ---------- expiry ----------
t('expiredRowIds finds stale rows', () => {
  const now = new Date('2026-06-17T12:00:00Z');
  const rows = [
    row({ id: 'old', expected_type: 'nudge_reply', opened_at: '2026-06-17T00:00:00Z', expires_at: '2026-06-17T06:00:00Z' }),
    row({ id: 'fresh', expected_type: 'nudge_reply', opened_at: '2026-06-17T11:00:00Z', expires_at: '2026-06-17T17:00:00Z' }),
  ];
  assert.deepStrictEqual(pr.expiredRowIds(rows, now), ['old']);
});

console.log('pendingReplies.test.js: ' + passed + ' assertions passed');
