/* War Room module tests — run: node warRoom.test.js  (plain assert, no framework) */
'use strict';
const assert = require('assert');
const wr = require('./warRoom');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL:', name); throw e; } }

// ---------- W1 classifySessionType ----------
t('classify PROBLEM', () => assert.strictEqual(wr.classifySessionType('PROBLEM'), 'problem'));
t('classify lowercase opportunity', () => assert.strictEqual(wr.classifySessionType('opportunity'), 'opportunity'));
t('classify strategy with trailing words', () => assert.strictEqual(wr.classifySessionType('STRATEGY please'), 'strategy'));
t('classify with leading punctuation', () => assert.strictEqual(wr.classifySessionType('  -problem'), 'problem'));
t('classify prefix match (problems)', () => assert.strictEqual(wr.classifySessionType('problems'), 'problem'));
t('classify unknown -> null', () => assert.strictEqual(wr.classifySessionType('help me'), null));
t('classify null -> null', () => assert.strictEqual(wr.classifySessionType(null), null));

// ---------- W2 nextPhase ----------
t('phase context -> diagnosis', () => assert.strictEqual(wr.nextPhase('context'), 'diagnosis'));
t('phase diagnosis -> reason', () => assert.strictEqual(wr.nextPhase('diagnosis'), 'reason'));
t('phase reason -> close', () => assert.strictEqual(wr.nextPhase('reason'), 'close'));
t('phase close -> done', () => assert.strictEqual(wr.nextPhase('close'), 'done'));
t('phase done -> done', () => assert.strictEqual(wr.nextPhase('done'), 'done'));
t('phase unknown -> done', () => assert.strictEqual(wr.nextPhase('bogus'), 'done'));
t('isTerminal done', () => assert.strictEqual(wr.isTerminalPhase('done'), true));
t('isTerminal reason false', () => assert.strictEqual(wr.isTerminalPhase('reason'), false));

// ---------- W3 shouldReflect ----------
t('reflect when conf 0.6', () => assert.strictEqual(wr.shouldReflect(0.6, 0), true));
t('no reflect when conf 0.8 (boundary)', () => assert.strictEqual(wr.shouldReflect(0.8, 0), false));
t('no reflect when conf 0.95', () => assert.strictEqual(wr.shouldReflect(0.95, 0), false));
t('reflect stops at max retries', () => assert.strictEqual(wr.shouldReflect(0.5, wr.MAX_REFLECT_RETRIES), false));
t('reflect null conf -> false', () => assert.strictEqual(wr.shouldReflect(null, 0), false));

// ---------- W4 shouldDeepDive ----------
t('deep dive on DEEP keyword', () => assert.strictEqual(wr.shouldDeepDive('DEEP', 0.9), true));
t('deep dive on deep lowercase', () => assert.strictEqual(wr.shouldDeepDive('deep', 0.9), true));
t('deep dive on low confidence', () => assert.strictEqual(wr.shouldDeepDive('continue', 0.65), true));
t('no deep dive at 0.7 boundary', () => assert.strictEqual(wr.shouldDeepDive('continue', 0.7), false));
t('no deep dive high conf no keyword', () => assert.strictEqual(wr.shouldDeepDive('ok', 0.85), false));

// ---------- W5 shouldRetryClose ----------
t('retry close when conf 7', () => assert.strictEqual(wr.shouldRetryClose(7), true));
t('no retry close when conf 8 (boundary)', () => assert.strictEqual(wr.shouldRetryClose(8), false));
t('no retry close when conf 10', () => assert.strictEqual(wr.shouldRetryClose(10), false));
t('retry close when conf missing', () => assert.strictEqual(wr.shouldRetryClose(null), true));

// ---------- W7 parseFollowup ----------
t('followup YES', () => assert.deepStrictEqual(wr.parseFollowup('yes'), { outcome: 'completed', action_completed: true }));
t('followup NO', () => assert.deepStrictEqual(wr.parseFollowup('NO'), { outcome: 'blocked', action_completed: false }));
t('followup DEFER', () => assert.deepStrictEqual(wr.parseFollowup('Defer'), { outcome: 'deferred', action_completed: false }));
t('followup garbage -> null', () => assert.strictEqual(wr.parseFollowup('maybe later'), null));

// ---------- W6 detectRecurringPattern ----------
t('detect recurring theme (3 in window)', () => {
  const now = new Date('2026-06-17T00:00:00Z');
  const sessions = [
    { session_date: '2026-06-15', theme: 'Hiring' },
    { session_date: '2026-06-10', theme: 'hiring!' },
    { session_date: '2026-06-02', theme: 'Hiring' },
    { session_date: '2026-06-12', theme: 'pricing' },
  ];
  const r = wr.detectRecurringPattern(sessions, { now });
  assert.strictEqual(r.recurring_theme_detected, true);
  assert.strictEqual(r.theme, 'hiring');
  assert.strictEqual(r.occurrences, 3);
});
t('no pattern when only 2 in window', () => {
  const now = new Date('2026-06-17T00:00:00Z');
  const sessions = [
    { session_date: '2026-06-15', theme: 'hiring' },
    { session_date: '2026-06-10', theme: 'hiring' },
  ];
  assert.strictEqual(wr.detectRecurringPattern(sessions, { now }).recurring_theme_detected, false);
});
t('old sessions outside window excluded', () => {
  const now = new Date('2026-06-17T00:00:00Z');
  const sessions = [
    { session_date: '2026-06-15', theme: 'hiring' },
    { session_date: '2026-01-01', theme: 'hiring' }, // >28d old
    { session_date: '2026-01-02', theme: 'hiring' }, // >28d old
  ];
  assert.strictEqual(wr.detectRecurringPattern(sessions, { now }).recurring_theme_detected, false);
});
t('empty sessions -> no pattern', () => {
  assert.strictEqual(wr.detectRecurringPattern([]).recurring_theme_detected, false);
});

// ---------- high usage ----------
t('high usage at 10', () => assert.strictEqual(wr.isHighUsage(10), true));
t('not high usage at 9', () => assert.strictEqual(wr.isHighUsage(9), false));

// ---------- prompts ----------
t('problem prompts has 4', () => assert.strictEqual(wr.sessionPrompts('problem').length, 4));
t('opportunity prompts has 4', () => assert.strictEqual(wr.sessionPrompts('opportunity').length, 4));
t('strategy prompts has 4', () => assert.strictEqual(wr.sessionPrompts('strategy').length, 4));
t('unknown type -> empty prompts', () => assert.strictEqual(wr.sessionPrompts('xyz').length, 0));

// ---------- system prompt ----------
t('system prompt names client + type', () => {
  const p = wr.buildSystemPrompt({ full_name: 'Raj', sessionType: 'problem', business_stage: 'growing' });
  assert.ok(p.includes('Raj'));
  assert.ok(p.includes('PROBLEM'));
  assert.ok(p.includes('first principles') || p.includes('FIRST PRINCIPLES'));
});
t('system prompt without type asks to choose', () => {
  const p = wr.buildSystemPrompt({ full_name: 'Raj' });
  assert.ok(p.includes('PROBLEM, OPPORTUNITY, or STRATEGY'));
});

console.log('warRoom.test.js: ' + passed + ' assertions passed');
