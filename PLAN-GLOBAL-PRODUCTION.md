# Relentless AI — Global Production Plan (2026-07-02)

Diagnosis of why SMS delivery is broken for beta users, and the exact plan to make the
system world-timezone, multi-client, and truly personalized. This is the working plan —
follow phases in order; each phase has a verification gate before moving on.

---

## PART 1 — DEEP DIAGNOSIS (verified against the live Hetzner system, 2026-07-02)

Evidence source: live n8n SQLite execution history + live workflow node code + live Airtable
client data pulled from execution `13803`/`13812` (morningCheckin1, 2026-07-02 10:30/11:30 UTC).

### Bug 1 — Every sender only serves the FIRST client (CRITICAL)
All Code nodes (`decide`, `prepInput`, `computeScore`, `normalizeClient`, `extract`, …) in
every sender run in n8n's **"Run Once for All Items"** mode, but the code reads `$json`
(= item #0 only) and `return [{json:…}]` (= one output item).

**Proof:** execution 13803 → `loadProfile` output **14 clients**, `decide` output **1 item**
(`client_120c369d`). Only that one client got the morning check-in. Same pattern confirmed in:
`morningCheckin1, briefFallback1, eodPro00001ghl, market000001, nudgeEngineGhl1,
onboard00001ghl, stageTrans01ghl, weekly000001ghl, recurReminder1 (normalizeProfile/matchFire)`.

**This is the "many people not getting SMS" bug.** 13 of 14 clients receive nothing, ever.

**Fix:** switch these nodes to `mode: runOnceForEachItem` (code uses `$json`/`return {json}`)
OR keep all-items mode and loop `$input.all()` returning an array. Standardize on ONE pattern
(per-each-item is safest with the existing code shape; TZ gate `return []` semantics hold).

### Bug 2 — Everyone's timezone is America/New_York (CRITICAL)
Live Airtable data: 11/14 clients `timezone=America/New_York`, 3 `UTC`/blank — including all
Indian (+91), Nigerian (+234) and Pakistani (+92) numbers.

**Cause:** `relentless-web/src/app/onboarding/page.tsx` uses a **US-only timezone list**,
default `America/New_York`. Browser auto-detect exists but only applies
`if (TIMEZONES.includes(tz))` — so `Asia/Kolkata`, `Africa/Lagos`, etc. are silently discarded.

**Fix (worldwide selector):** replace the hardcoded list with the full IANA set via
`Intl.supportedValuesOf("timeZone")` (~420 zones), searchable dropdown grouped by region,
default = browser-detected zone (always applied, no allowlist). Same control in Profile page.
Sync path already works: onboarding → Supabase `profiles.timezone` → `/api/provision` +
`/api/profile-sync` → Airtable `clients.timezone` (verified in code — only the LIST is wrong).
One-time backfill: correct existing 14 clients' timezone in Airtable.

### Bug 3 — 8 of 14 clients have NO ghl_contact_id (CRITICAL)
`send: !!(p.ghl_contact_id)` → clients without a GHL contact are silently dropped even when
selected. 8/14 live clients have `ghl_contact_id` empty → can never receive any SMS.

**Fix:** provisioning must create the GHL contact for every signup (E.164 phone) and write the
id back to Airtable; add an n8n repair job that finds clients with phone+no ghl_contact_id,
creates the contact via GHL API, and patches the row. Alert (DLQ) instead of silent drop.

### Bug 4 — Inbound is dead → personalization never happens (CRITICAL)
`ghlInboundV1` executed **once in 3 days** (our own test). No user replies reach n8n.
Consequence chain: no morning check-in replies → no sleep/energy/stress scores → the
mood-adapted `briefBuilder1` never triggers (4 runs in 3 days, all test) → `briefFallback1`
sends the generic template briefing every day → **"same briefing daily"**.

**Fix:** re-verify/republish the GHL "Customer Replied" workflow → webhook
`/webhook/ghl-inbound`; add an inbound heartbeat to the SLA monitor (alert if 0 inbound in
24h while sends > 0). Note: India↔US SMS is carrier-blocked — Indian testers can't reply by
SMS at all (platform constraint, not a bug; real US clients can).

### Bug 5 — Briefing is not unique/personalized (HIGH)
Two builders exist: `briefBuilder1` (mood-adapted: uses check-in scores) and `briefFallback1`
(7AM, `hasMood:false`, generic). Because of Bug 4, only the fallback fires. Additionally the
fallback prompt has no day-varying inputs (no date, tasks, meetings, biometrics, history) →
Claude produces near-identical text daily.

**Fix (the intelligence upgrade — Phase 4):** single briefing pipeline that ALWAYS builds a
rich context pack per client: today's tasks (with effort tags), meetings, yesterday's score,
last check-in (sleep/energy/stress; fallback = yesterday's), streaks, last 3 briefing texts
("do not repeat these"). Energy-aware task triage: low energy → recommend the lightest
high-value task; high energy → hardest priority. Passing recent-briefing history is what
guarantees daily uniqueness.

### Bug 6 — Meeting reminder workflow is archived + inactive (HIGH)
`meetReminder1`: `active=0, isArchived=1` in the live DB. No meeting reminder SMS fire at
all. Fixed JSON already exists (`build/n8n/_deploy3/meetReminder1.json`: prefers absolute
`scheduled_at`, 5-min lead). Archived workflows can't be published by CLI → import fixed
JSON as a NEW workflow id (`meetReminder2`) and activate; retire the archived one.

### Bug 7 — Daily false SLA alert (MEDIUM) — the "RELENTLESS AI ALERT" you receive
`slaMonitor1` runs at **01:15 UTC** and checks for a `morning_checkin` artifact in the last
6h. The morning send happens at 10:30 UTC (6 AM ET). 01:15 − 10:30 = **~15h gap → your
alert says "(15h ago)" every day**. The monitor is mis-scheduled, not the send.
**Fix:** run the monitor per-client-timezone (e.g. 2h after each client's target hour), and
check per-client artifacts, not a global one. Also add: delivery-failure alerts + inbound
silence alert.

### Constraint 8 — International SMS delivery (PLATFORM)
GHL/LeadConnector (US A2P) cannot reliably deliver to +91/+234/etc. Even with all code fixed,
non-US numbers may not receive SMS. Options: (a) beta = US numbers only (current GHL stack
works), (b) Twilio international senders per-region, (c) WhatsApp Business channel for
non-US (already proven via sandbox). Decision needed — recommend (a) now + (c) as fast-follow.

---

## PART 2 — THE PLAN (phases, in order; each has a verification gate)

### Phase 0 — Stop the bleeding (Day 1)
0.1 Backfill correct `timezone` for all 14 live clients in Airtable.
0.2 Import fixed `meetReminder2` + activate.
0.3 Re-publish GHL "Customer Replied" → `/webhook/ghl-inbound`; send a test reply end-to-end.
0.4 Fix `closePending` (pending rows not closing on DONE) — Airtable v2.2
    `matchingColumns:['id']` pattern in `ghlInboundV1`.
**Gate:** test client receives check-in → replies → pending row closes → score stored.

### Phase 1 — Multi-client engine fix (Days 1–2) ← the big one
1.1 Script (`_fix_run_per_item.js`) that, for the 9 sender workflows: sets every per-client
    Code node to `runOnceForEachItem`, adapts `return [{json}]` → `return {json}`, keeps the
    TZ-gate `return []` skip, and converts any lingering `$input.first()`/`.first()` → `.item`.
1.2 Offline simulation: feed 14-client fixture through each gate/build function; assert
    N-in → N-eligible-out (not 1).
1.3 Deploy via docker cp → import → publish → restart. Verify next hourly run:
    `decide` out-count == eligible clients.
**Gate:** live execution shows ≥2 clients passing the gate at their local hour, each
receiving their OWN personalized message (no cross-contamination).

### Phase 2 — Worldwide timezone selection (Days 2–3)
2.1 `relentless-web`: replace US list with full IANA zones
    (`Intl.supportedValuesOf("timeZone")`), searchable select grouped by continent, label
    with live UTC offset + major city; browser auto-detect always pre-fills.
2.2 Same component in Profile page; changes sync to Airtable via existing profile-sync.
2.3 Server-side validation: reject non-IANA values at `/api/provision` + `/api/profile-sync`.
2.4 Vercel deploy (user runs) + verify a fake signup from an Asian tz lands in Airtable.
**Gate:** new signup with Asia/Kolkata gets briefing at 7 AM IST (01:30 UTC run).

### Phase 3 — GHL contact provisioning repair (Day 3)
3.1 Provision route: always create GHL contact (E.164), write id to Airtable + Supabase.
3.2 n8n repair job `contactRepair1` (every 6h): clients with phone + no ghl_contact_id →
    create contact → patch row → DLQ alert on failure.
**Gate:** 0 active clients without ghl_contact_id.

### Phase 4 — Briefing intelligence upgrade (Days 4–6)
4.1 Merge briefBuilder1/briefFallback1 into one pipeline: per client build context pack —
    tasks (+effort), meetings today, yesterday's score + components, latest check-in
    (or yesterday's), streaks, last 3 briefings (anti-repetition), local weekday/date.
4.2 Energy-aware triage rules in the system prompt (low energy → lightest high-value task,
    high stress → one thing + a boundary, good sleep+energy → hardest priority first).
4.3 Persist every briefing to tbl_briefings (already live) + store context-pack hash for QA.
4.4 Offline eval: 5 personas × 3 days fixtures → assert briefings differ day-to-day and
    reference the persona's actual tasks/scores.
**Gate:** 3 consecutive days of live briefings for 2 clients are unique + task-specific.

### Phase 5 — Observability that tells the truth (Day 7)
5.1 Rebuild SLA monitor: per-client expected-send ledger (client × workflow × local target
    hour) → alert lists WHICH clients missed, only after their window passed.
5.2 Delivery check: query GHL message status (failed/undelivered) → DLQ + daily digest.
5.3 Inbound silence alert (sends>0 & inbound==0 in 24h). Kill the current 01:15 false alert.
**Gate:** one daily digest SMS/email that matches reality (no false alerts for 3 days).

### Phase 6 — International delivery decision (Week 2)
US-only numbers for beta now; WhatsApp Business channel for non-US as fast-follow;
per-client `channel` field (sms|whatsapp) routed at send time. (Decision gate with user.)

---

## Deploy method (unchanged)
`docker cp` → `docker exec n8n-n8n-1 n8n import:workflow --input=…` →
`n8n publish:workflow --id=…` → `cd /root/n8n && docker compose restart n8n`.
SSH: key `~/.ssh/id_dadaai` (the old `build/n8n/hetzner/ssh/n8n_hetzner` key was REVOKED
server-side; id_dadaai works). Container `n8n-n8n-1`, DB SQLite.
