/**
 * Relentless AI — War Room state-machine module (Phase 9, Pro-only). Spec §12.
 *
 * Pure logic ONLY (no I/O, no SMS, no Airtable). The n8n War Room workflow drives the
 * conversation by calling these functions between inbound replies; Claude does the actual
 * strategic reasoning. This module owns: session-type routing, phase progression, the
 * confidence gates (REFLECT / DEEP / close-retry), follow-up parsing, recurring-pattern
 * detection, and the canonical Claude system prompt. NEVER re-derive these inline in a node.
 *
 * PINNED DECISIONS (spec §12 was prose; these make it deterministic):
 *   W1. Session type is taken from the FIRST word match: PROBLEM→problem, OPPORTUNITY→opportunity,
 *       STRATEGY→strategy (case-insensitive, leading punctuation stripped). No match → null (re-ask).
 *   W2. Phase order: context → diagnosis → reason → close → done. "reason" covers the
 *       DECOMPOSE/SOLVE/VERIFY/SYNTHESIZE/REFLECT loop (one logical phase, may repeat internally).
 *   W3. REFLECT retry fires when a reasoning-step confidence < 0.8 (spec: "if conf <0.8, find
 *       weakness + retry"). Capped at MAX_REFLECT_RETRIES to guarantee termination.
 *   W4. First-Principles Deep Dive triggers on reply 'DEEP' (any case) OR confidence < 0.7.
 *   W5. Close confidence is a 1–10 integer; < CLOSE_MIN_CONFIDENCE (8) → one REFLECT retry of the
 *       weakest assumption before committing (spec: "if <8 → retry weakest assumption").
 *   W6. Recurring pattern = a normalized theme token appearing in >= PATTERN_MIN_OCCURRENCES (3)
 *       sessions within the last PATTERN_WINDOW_DAYS (28) days.
 *   W7. Follow-up reply parse: YES→completed, NO→blocked, DEFER→reschedule; else null (re-ask).
 */

'use strict';

const MAX_REFLECT_RETRIES = 2;     // W3 — terminate the SOLVE/REFLECT loop
const REFLECT_THRESHOLD = 0.8;     // W3
const DEEP_DIVE_THRESHOLD = 0.7;   // W4
const CLOSE_MIN_CONFIDENCE = 8;    // W5 (1–10 scale)
const PATTERN_MIN_OCCURRENCES = 3; // W6
const PATTERN_WINDOW_DAYS = 28;    // W6 (last 4 weeks)
const HIGH_USAGE_FLAG = 10;        // spec: flag clients using 10+ sessions/month

const SESSION_TYPES = ['problem', 'opportunity', 'strategy'];
const PHASES = ['context', 'diagnosis', 'reason', 'close', 'done'];

// ---------- W1: session-type routing ----------
function classifySessionType(reply) {
  if (reply == null) return null;
  const first = String(reply).trim().toLowerCase().replace(/^[^a-z]+/, '').split(/\s+/)[0] || '';
  if (first.startsWith('problem')) return 'problem';
  if (first.startsWith('opportunity')) return 'opportunity';
  if (first.startsWith('strategy')) return 'strategy';
  return null; // W1 — re-ask
}

// ---------- W2: phase progression ----------
function nextPhase(currentPhase) {
  const i = PHASES.indexOf(currentPhase);
  if (i === -1 || i >= PHASES.length - 1) return 'done';
  return PHASES[i + 1];
}

function isTerminalPhase(phase) {
  return phase === 'done';
}

// ---------- W3: REFLECT retry gate ----------
// Returns whether the reasoning loop should REFLECT-and-retry given a step confidence and
// how many retries have already happened.
function shouldReflect(confidence, retriesSoFar = 0) {
  const c = _num(confidence);
  if (c === null) return false;
  if (retriesSoFar >= MAX_REFLECT_RETRIES) return false; // W3 termination guard
  return c < REFLECT_THRESHOLD;
}

// ---------- W4: First-Principles Deep Dive ----------
function shouldDeepDive(reply, confidence) {
  if (reply != null && String(reply).trim().toLowerCase() === 'deep') return true;
  const c = _num(confidence);
  return c !== null && c < DEEP_DIVE_THRESHOLD;
}

// ---------- W5: close-with-commitment confidence gate ----------
// finalConfidence is 1–10. Below the floor → retry the weakest assumption once.
function shouldRetryClose(finalConfidence) {
  const c = _num(finalConfidence);
  if (c === null) return true; // missing confidence → don't commit yet
  return c < CLOSE_MIN_CONFIDENCE;
}

// ---------- W7: follow-up reply parse (24h accountability) ----------
function parseFollowup(reply) {
  if (reply == null) return null;
  const u = String(reply).trim().toUpperCase();
  if (u === 'YES' || u === 'Y') return { outcome: 'completed', action_completed: true };
  if (u === 'NO' || u === 'N') return { outcome: 'blocked', action_completed: false };
  if (u === 'DEFER' || u === 'D') return { outcome: 'deferred', action_completed: false };
  return null; // W7 — re-ask
}

// ---------- W6: recurring-pattern detection ----------
// sessions: [{ session_date: ISO|Date, theme: string }, ...]. Returns the dominant recurring
// theme (or null) plus the per-theme counts within the window.
function detectRecurringPattern(sessions, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const windowDays = opts.windowDays != null ? opts.windowDays : PATTERN_WINDOW_DAYS;
  const minOcc = opts.minOccurrences != null ? opts.minOccurrences : PATTERN_MIN_OCCURRENCES;
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const counts = {};
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || !s.theme) continue;
    const t = new Date(s.session_date).getTime();
    if (!Number.isFinite(t) || t < cutoff || t > now.getTime()) continue;
    const key = _normTheme(s.theme);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }

  let topTheme = null, topCount = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > topCount) { topTheme = k; topCount = v; }
  }
  const detected = topCount >= minOcc;
  return {
    recurring_theme_detected: detected,
    theme: detected ? topTheme : null,
    occurrences: topCount,
    counts,
  };
}

// ---------- high-usage flag (spec: 10+ sessions/month → check-in) ----------
function isHighUsage(sessionsThisMonth) {
  return _num(sessionsThisMonth) !== null && sessionsThisMonth >= HIGH_USAGE_FLAG;
}

// ---------- session-type prompt blocks (4 lines each; spec §12.4) ----------
const SESSION_PROMPTS = {
  problem: [
    'Is this the real problem, or a symptom of something deeper?',
    'What is the single root cause if you strip away everything non-essential?',
    'What would you do if your current approach were completely off the table?',
    'What is the smallest next action that proves or disproves your theory?',
  ],
  opportunity: [
    'Which underexplored opportunity has the highest leverage relative to effort?',
    'What would have to be true for this to be your biggest win this quarter?',
    'What are you NOT doing that a smart competitor would do here?',
    'What is the first concrete experiment to validate it cheaply?',
  ],
  strategy: [
    'What should you STOP doing that no longer serves the 12-month goal?',
    'What should you START that you have been avoiding?',
    'What is working that you should DOUBLE DOWN on?',
    'Which single decision, made today, most changes the trajectory?',
  ],
};

function sessionPrompts(sessionType) {
  return SESSION_PROMPTS[sessionType] ? SESSION_PROMPTS[sessionType].slice() : [];
}

// ---------- canonical Claude system prompt (spec §12 "Claude system prompt") ----------
function buildSystemPrompt({ full_name = 'there', sessionType = null, business_stage = 'growing' } = {}) {
  const typeLine = sessionType
    ? 'SESSION TYPE: ' + sessionType.toUpperCase() + '.'
    : 'SESSION TYPE: not yet chosen — ask the client to reply PROBLEM, OPPORTUNITY, or STRATEGY.';
  return [
    'You are a strategic thinking partner in a War Room session with ' + full_name + ', a ' +
      business_stage + '-stage executive. You think from FIRST PRINCIPLES.',
    typeLine,
    'RULES: Pressure-test the client — do NOT validate them. Ask the uncomfortable question they ' +
      'have been avoiding. Strip every claim to what is provably true. Every reply MUST end with ' +
      'exactly one question OR one concrete action.',
    'METHOD: DECOMPOSE the problem, SOLVE each part with an explicit confidence score 0.0-1.0, ' +
      'VERIFY (logic, facts, completeness, bias), then SYNTHESIZE weighted by confidence. If any ' +
      'component scores below 0.8, REFLECT — name its weakness and retry it before synthesizing.',
    'OUTPUT: plain-text SMS, no emojis, under 320 characters per message.',
  ].join('\n');
}

// ---------- helpers ----------
function _num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function _normTheme(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  classifySessionType, nextPhase, isTerminalPhase,
  shouldReflect, shouldDeepDive, shouldRetryClose, parseFollowup,
  detectRecurringPattern, isHighUsage, sessionPrompts, buildSystemPrompt,
  SESSION_TYPES, PHASES,
  MAX_REFLECT_RETRIES, REFLECT_THRESHOLD, DEEP_DIVE_THRESHOLD,
  CLOSE_MIN_CONFIDENCE, PATTERN_MIN_OCCURRENCES, PATTERN_WINDOW_DAYS, HIGH_USAGE_FLAG,
};
