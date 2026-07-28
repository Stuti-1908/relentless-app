## 12. War Room — Strategic Brainstorm Mode ★ NEW (Phase 9, Pro-only, ~8h)
**Trigger:** on demand — Pro client texts **`WAR ROOM`** to the Relentless AI number; starts
immediately. **Output:** structured SMS session ending in a committed action. **Airtable:**
`tbl_war_room_sessions`.
- **Session types:** Problem Solving (root cause + next action) · Opportunity Mapping
  (highest-leverage underexplored) · Strategic Review (stop/start/double-down).
- **Flow:**
  1. **Context (2 min):** "War Room activated, {name}. What are we solving today? Reply PROBLEM,
     OPPORTUNITY, or STRATEGY." Then: describe in one sentence / what does solved look like / how
     long unresolved / what tried.
  2. **Diagnosis:** problem vs symptom vs decision; assumptions; strip to what's provably true;
     what would you do if current approach was off the table.
  3. **DECOMPOSE / SOLVE (explicit confidence 0.0–1.0) / VERIFY (logic, facts, completeness, bias)
     / SYNTHESIZE (weighted by confidence) / REFLECT (if conf <0.8, find weakness + retry).**
  4. **Session-type prompts** (4 each — see PDF p.17 for full lists).
  5. **First-Principles Deep Dive (optional):** triggered by reply `DEEP` or confidence <0.7.
  6. **Close with commitment (3 min):** one insight; one action within 24h + deadline; confidence
     1–10 (if <8 → retry weakest assumption via REFLECT). STORE committed_action, action_due_date,
     final_confidence. CREATE GHL task (due=action_due_date, tag `source:war_room`).
- **Follow-up accountability:** 24h after session (or on due date if sooner): "Did you complete
  [{action}]? YES/NO/DEFER." YES→action_completed=true + note in next briefing; NO→ask what got in
  the way + offer mini War Room; DEFER→capture new date, update action_due_date.
- **Recurring Pattern Detection — Monday 7:15 AM (build-team note: spec body says 7:00; manager
  brief says 7:15 — confirm; use 7:15 unless told otherwise):** pull last 4 weeks of sessions; if a
  theme appears 3+ times, SMS offering a dedicated deep dive; set `recurring_theme_detected=true`.
- **Availability:** Standard = NOT included. Pro = unlimited, no scheduling. Flag clients using 10+
  sessions/month for check-in. **Gate every War Room workflow strictly on `plan = pro`.**
- **Claude system prompt:** strategic thinking partner; first-principles; pressure-tests (doesn't
  validate); asks the uncomfortable avoided question; every reply ends with one question or action;
  explicit confidence scores; retry weak components before synthesizing. (Full text: PDF p.18.)

## 13. Security Requirements
API keys only as n8n credentials (never hardcoded) · Whoop/Oura tokens with refresh workflows ·
ambient = processed text only (never raw audio) · per-client isolation (separate GHL sub-account,
Airtable base, n8n credential set) · always filter by client_id (never cross-client) · validate
inbound SMS webhook source before processing · `context_override` never logged externally ·
`tbl_feedback` never shared · consent records never deleted · monthly deletion job ·
**`tbl_war_room_sessions` highly confidential — never in analytics export or third-party
integration.**

## 14. Testing Checklist
Run all tests with a test client before any paying client. Covers Phase 0 (biometric/manual/
calendar/SMS/consent), Phase 1 (briefing, stage tone, override, recovery <60 and >80), Phase 2
(composite + labels, Pro 6-pillar, biometric_missing→60, feedback timing), Phase 3 (transcript→GHL),
Phase 4 (nudge + reply update), Phase 5 (7-day averages, 3-day-low alert), Phase 7/8 Pro, **Phase 9
War Room (trigger, full session row, GHL task tag+due, 24h follow-up, YES/DEFER handling,
Standard-inaccessible, recurring_theme on Monday)**, 7-day sequence, stage transition, monthly
report. (Full list: PDF p.20.)

## 15. Build Timeline (8 weeks)
1. DB schemas + Phase 0 + consent + wearable/manual setup → **all tables built incl.
   `tbl_war_room_sessions`**.
2. Phase 1 Morning Briefing (stage-aware + manual biometric) → first live briefing.
3. Phase 2 Daily Score + bad-day override + feedback → first evening score. **← Standard-stable
   gate; War Room may NOT start before this.**
4. 7-day sequence + Phase 4 nudges + Phase 3 ambient → full daily loop.
5. Phase 5 adaptation + stage transition + Pro Phase 7 → business health live for Pro test client.
6. Pro Phase 8 market intel + Pro scoring pillars + monthly report → Pro daily loop, first Pro
   client ready.
7. **Phase 9 War Room** SMS engine + session flow + DECOMPOSE/SOLVE/VERIFY/SYNTHESIZE/REFLECT + GHL
   task → War Room live for Pro.
8. War Room follow-up loop + recurring pattern detection + first-principles escalation → full War
   Room operational + tested.

> Build Standard first; one test client on a working daily loop by end of Week 3. Layer Pro on top.
> Do NOT build War Room before Standard is stable. War Room is Pro-only — gate strictly with
> `plan = pro`.

*Digital Dada Technologies · Fort Lauderdale, FL · Confidential — For Stuti.*
