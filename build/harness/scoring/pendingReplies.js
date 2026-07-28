/**
 * Relentless AI — Pending-replies state machine (god plan §5.0.5).
 *
 * Pure logic for matching ONE inbound SMS to the correct open conversation when several are
 * pending for the same client. n8n owns the Airtable I/O (read open rows from
 * tbl_pending_replies, write status=matched, write the domain effect, log unmatched); this
 * module owns the DETERMINISTIC match-priority decision so two builders can't diverge.
 *
 * expected_type enum (spec §5.0.5):
 *   sequence types : weekly_checkin (q index 1-5), manual_biometric (3 numbers 1-5)
 *   single-shot    : score_feedback, briefing_feedback, bad_day_override, stage_transition, day7_feedback
 *   free-text      : nudge_reply, customer_learning
 *
 * MATCH PRECEDENCE (fixed; resolve when multiple rows are open):
 *   (1) an in-progress MULTI-STEP SEQUENCE by its context_ref index (earliest opened first);
 *   (2) the MOST RECENTLY opened single-shot row whose answer-shape fits the reply;
 *   (3) else the newest open FREE-TEXT row.
 * No fit, or a tie between two equally-ranked rows → unmatched (caller logs + alerts).
 *
 * PINNED DECISIONS:
 *   R1. A reply is "sequence-shaped" if it is a single 1-5 number (manual_biometric step or a
 *       weekly_checkin scale answer). Sequences always win over single-shot/free-text.
 *   R2. Single-shot answer-sets are matched case-insensitively against the type's accept list.
 *   R3. Ties at the same rank → unmatched (never guess). Expired/closed rows are ignored.
 *   R4. Among multiple open sequences, the EARLIEST opened_at is resumed first (finish what you
 *       started); among single-shot matches, the LATEST opened_at wins (most recent question).
 */

'use strict';

const SEQUENCE_TYPES = ['weekly_checkin', 'manual_biometric', 'morning_checkin'];
const FREETEXT_TYPES = ['nudge_reply', 'customer_learning'];

// Single-shot accept-sets (R2).
const SINGLE_SHOT_ACCEPTS = {
  score_feedback:   ['YES', 'Y', 'NO', 'N', 'SOMEWHAT', 'SKIP'],
  briefing_feedback:['YES', 'Y', 'NO', 'N', 'SOMEWHAT', 'SKIP'],
  day7_feedback:    ['YES', 'Y', 'NO', 'N', 'SOMEWHAT', 'SKIP'],
  bad_day_override: ['UPDATE', 'KEEP', 'YES', 'NO'],
  stage_transition: ['ON TRACK', 'TIGHT', 'CRITICAL', 'YES', 'NO'],
  recurring_reminder: ['DONE', 'DID IT', 'SKIP', 'SKIPPED', 'YES', 'NO'],
};

// ---------- shape predicates ----------
function isScaleNumber(reply) {
  const s = String(reply == null ? '' : reply).trim();
  return /^[1-5]$/.test(s);
}
function isThreeScaleNumbers(reply) {
  const nums = (String(reply == null ? '' : reply).match(/[1-5]/g) || []);
  return nums.length >= 3;
}
function normUpper(reply) {
  return String(reply == null ? '' : reply).trim().toUpperCase();
}

// Does the reply's shape fit a given expected_type?
function answerShapeFits(expectedType, reply) {
  if (expectedType === 'manual_biometric') return isThreeScaleNumbers(reply) || isScaleNumber(reply);
  if (expectedType === 'weekly_checkin') return isScaleNumber(reply) || normUpper(reply).length > 0;
  // morning_checkin matches ANY non-empty reply so the router can either act on 3 reads or re-ask.
  if (expectedType === 'morning_checkin') return String(reply == null ? '' : reply).trim().length > 0;
  if (FREETEXT_TYPES.includes(expectedType)) return String(reply == null ? '' : reply).trim().length > 0;
  const accepts = SINGLE_SHOT_ACCEPTS[expectedType];
  if (accepts) return accepts.includes(normUpper(reply));
  return false;
}

function isSequenceType(t) { return SEQUENCE_TYPES.includes(t); }
function isFreetextType(t) { return FREETEXT_TYPES.includes(t); }

// ---------- core matcher ----------
// openRows: [{ id, client_id, expected_type, context_ref, opened_at, status }]
// Returns { matched:true, row, rank, reason } or { matched:false, reason }.
function matchReply(openRows, reply, opts = {}) {
  const clientId = opts.client_id;
  const rows = (Array.isArray(openRows) ? openRows : [])
    .filter(r => r && r.status === 'open')
    .filter(r => clientId == null || r.client_id === clientId);

  if (!rows.length) return { matched: false, reason: 'no_open_rows' };

  // ---- Rank 1: in-progress sequences, earliest opened first (R4) ----
  const seqRows = rows
    .filter(r => isSequenceType(r.expected_type) && answerShapeFits(r.expected_type, reply))
    .sort((a, b) => _ts(a.opened_at) - _ts(b.opened_at));
  if (seqRows.length) {
    if (_tie(seqRows, 'opened_at', true)) return { matched: false, reason: 'ambiguous_sequence_tie' };
    return { matched: true, row: seqRows[0], rank: 1, reason: 'sequence_in_progress' };
  }

  // ---- Rank 2: single-shot, most recently opened first (R4) ----
  const singleRows = rows
    .filter(r => SINGLE_SHOT_ACCEPTS[r.expected_type] && answerShapeFits(r.expected_type, reply))
    .sort((a, b) => _ts(b.opened_at) - _ts(a.opened_at));
  if (singleRows.length) {
    if (_tie(singleRows, 'opened_at', false)) return { matched: false, reason: 'ambiguous_single_tie' };
    return { matched: true, row: singleRows[0], rank: 2, reason: 'single_shot_match' };
  }

  // ---- Rank 3: free-text, newest open row ----
  const freeRows = rows
    .filter(r => isFreetextType(r.expected_type) && answerShapeFits(r.expected_type, reply))
    .sort((a, b) => _ts(b.opened_at) - _ts(a.opened_at));
  if (freeRows.length) {
    return { matched: true, row: freeRows[0], rank: 3, reason: 'freetext_fallback' };
  }

  return { matched: false, reason: 'no_shape_fit' };
}

// Expiry helper: given rows + now, return ids of rows past expires_at (caller sets status=expired).
function expiredRowIds(openRows, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return (Array.isArray(openRows) ? openRows : [])
    .filter(r => r && r.status === 'open' && r.expires_at && _ts(r.expires_at) < t)
    .map(r => r.id);
}

// ---------- helpers ----------
function _ts(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
// Is there a tie at the extreme (earliest if earliest=true, else latest) opened_at?
function _tie(sortedRows, key, earliest) {
  if (sortedRows.length < 2) return false;
  return _ts(sortedRows[0][key]) === _ts(sortedRows[1][key]);
}

module.exports = {
  matchReply, expiredRowIds, answerShapeFits,
  isSequenceType, isFreetextType, isScaleNumber, isThreeScaleNumbers,
  SEQUENCE_TYPES, FREETEXT_TYPES, SINGLE_SHOT_ACCEPTS,
};
