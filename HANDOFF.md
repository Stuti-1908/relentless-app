<system-reminder>[Truncated: PARTIAL view — showing lines 1-704 of 920 total (27759 tokens, cap 25000). Call Read with offset=705 limit=704 for the next page, or Grep to find a specific section. Do NOT answer from this page alone if the answer may be further in the file.]</system-reminder>

# Relentless AI — Project Handoff / Context Primer

> **New Claude Code session? Read this file first, then `GOECOACH-GOD-PLAN.md`.** It tells you
> what this project is, what's already built, what's next, and how to work with the user.
>
> ⚠️ **Naming note (rebrand 2026-06-03):** the product was renamed **GoeCoach → Relentless AI**.
> Doc *contents*, SMS copy, and the Airtable base display names are rebranded. INTENTIONALLY kept
> as-is to avoid breaking things: the folder name `GoeCoach-Plan`, the file name
> `GOECOACH-GOD-PLAN.md`, and the n8n credential names `Airtable GoeCoach` / `Twilio GoeCoach`
> (live n8n objects — guides must keep matching them). Do NOT "fix" those.

---

## 1. What this project is
**Relentless AI / Relentless AI Pro** — an AI executive-coaching *managed service* delivered over
**SMS**. Every morning it texts a CEO a personalized briefing (top priorities based on their data);
evening it texts an "Executive Score"; plus nudges, weekly business check-ins, monthly reports, and
(Pro) an on-demand **War Room** strategic brainstorm. Built for client **"Raj"** at **Digital Dada
Technologies**. **End clients are US-based.** (Was "GoeCoach" before the 2026-06-03 rebrand.)

Architecture: **n8n** orchestrates workflows that pull data (Airtable + wearables + calendar),
ask **Claude** to write the messages, and send them via **Twilio** (and **GoHighLevel** later).
Each client gets isolated infra (separate Airtable base, etc.).

## 2. Current status (what actually works today)
✅ **Full Morning Briefing pipeline is LIVE end-to-end, persisted + self-scheduling:** n8n reads the
client profile from Airtable → builds a stage-aware prompt → Claude writes the briefing → Twilio
texts it → logs the row to `tbl_briefings` (Airtable Create, **Typecast ON**) → runs automatically
via a Schedule Trigger (workflow **Active**, TZ set). Tasks 1–8 complete (2026-06-02).
✅ **Inbound + two-way conversation working (Tasks 9–11, 2026-06-03):** inbound proven via the
**Twilio WhatsApp Sandbox** → n8n webhook (`/webhook/twilio-inbound`, workflow "Inbound SMS - test",
Active). The biometric round-trip works: operator WhatsApps `4 3 2` → `scoreReply` Code node runs
the tested `manualRecovery` formula → Twilio replies the recovery score → valid reports save to
`tbl_biometrics` (IF `valid` → Airtable Create, Typecast ON).

Four core integrations proven in n8n: **Airtable ✓ · Claude ✓ · Twilio outbound ✓ · Twilio inbound
(WhatsApp) ✓.**

✅ **The full Standard daily loop is now live + test-verified (5 active workflows, 2026-06-05):**
Morning Briefing (real recovery), End-of-Day Score, **Nudge Engine**, **Feedback Question**, and the
**Inbound router** (biometric / feedback / ack). See §5 for IDs + details.

✅ **Client web app scaffolded + real auth wired (`relentless-web/`, 2026-06-10):** a **Next.js 16
(App Router, TS, Tailwind)** app porting the mockup into 4 real screens — `/login` → `/consent` →
`/onboarding` → `/dashboard`. **Supabase Auth is live** (email+password sign-up/in + sign-out;
Google button wired but provider not yet enabled). **Route protection** via `src/proxy.ts` (Next 16
renamed middleware→proxy): signed-out users are redirected to `/login` (verified). **Consent is
persisted** to Supabase `user_metadata.consented_at` (asked once). Production build passes clean.
  - Supabase project: `https://iqdkoufpiafbhmicbdsy.supabase.co` (keys in `relentless-web/.env.local`,
    gitignored; uses the new `sb_publishable_…` key format). Email confirmation is **ON**;
    Google OAuth **not yet configured** (deferred — user's call 2026-06-10).
  - Run it: `cd relentless-web && npx next dev -p 3003` → http://localhost:3003. Dashboard data is
    still **placeholder/in-memory** (tasks reset on reload) — next step is per-user persistence.
  - This is a NEW workstream parallel to the n8n/SMS backend; they're not wired together yet.

✅ **Web↔backend bridge + write paths + polish (2026-06-10):** the web app now shares the backend's
data and can drive it.
  - **READ bridge (live):** `src/app/api/coaching/route.ts` (server-only, parallel reads, 401-guarded,
    60s cache) reads `tbl_daily_scores` / `tbl_biometrics` / `tbl_briefings` from the client_test base
    (`appjnWxg9sB3PV7Da`) → dashboard shows REAL score/recovery/briefing/30-day trend (placeholder
    fallback). Airtable read+write token in `.env.local` as `RELENTLESS_WEB_APP_AIRTABLE_TOKEN`.
  - **W1 WRITE (built; needs a profile Save to verify):** `src/app/api/profile-sync/route.ts` PATCHes
    `tbl_client_profile` (record `recPWs7Dn94QztPDo`, client_id `client_test`) with the user's
    full_name/phone/timezone/primary_goal→top_priority_1. Reachable via a **Profile edit screen**
    (`/onboarding?edit=1`, linked from the dashboard topbar) which also fires the sync on save.
    ⚠️ The auto-mode classifier BLOCKS Claude from writing to this live record directly — the write
    must come from the user's authenticated browser save.
  - **W2 WRITE (built; needs `WEB-06` SQL to activate):** `src/app/api/tasks-sync/route.ts` mirrors web
    to-dos → GHL contact tasks (`v8lIYQuHTAcLFmbJ0HUt`) via `services.leadconnectorhq.com`
    (`GHL_TOKEN`/`GHL_CONTACT_ID` in `.env.local`). Dashboard create/complete/delete call it; the GHL
    task id persists to `tasks.ghl_task_id` (add column: `alter table public.tasks add column if not
    exists ghl_task_id text;`). Feeds the real Execution pillar. Task load uses `select("*")` so it
    degrades gracefully before the column exists.
  - **P1 polish (built):** edit-task (click title to rename, click priority badge to cycle), global
    error boundary (`src/app/error.tsx`), mobile/responsive CSS pass, API auth guards + caching.
  - **A1:** Google provider is **enabled** in Supabase (auth settings `google:true`); round-trip
    needs a one-click verify.
  - Remaining user-only actions tracked in `relentless-web/PLAN/MANUAL-TODO.md`; full roadmap in
    `relentless-web/PLAN/00-ROADMAP.md`. Deploy (Vercel) + multi-client (W3) deferred by user.

✅ **Production reliability hardening — audit P0/P1s closed (2026-06-12):** see the audit
`reviews/RELIABILITY-AUDIT-2026-06.md` and patch pack `build/n8n/N8N-HARDENING-PATCHES.md`.
  - **Web (live):** `/api/profile-sync` + `/api/tasks-sync` no longer leak provider error text to the
    browser (logged server-side only); `/api/coaching` got a single-flight guard (no cold-start herd) +
    a 401 session check. All build green.
  - **n8n inbound HARDENED (live, tested):** new workflow **`inbHardenedV1`** ("Relentless AI - Inbound
    HARDENED") is the ACTIVE inbound on path **`twilio-inbound`**; the old `Y3ZygXA12WXfs7Hh` is now
    INACTIVE (kept as backup). It prepends to the tested biometric path (unchanged — `scoreReply` now
    reads `$('Webhook')`): **`sigCheck`** (Twilio `X-Twilio-Signature` HMAC-SHA1 via `crypto`, drops
    forged/unsigned) → **`searchSeen`/`dedupGate`** (idempotency on `MessageSid` via `tbl_inbound_seen`,
    drops duplicates) → **`createSeen`** → scoreReply. Verified live: valid signed → processed; forged →
    dropped; duplicate → dropped. (Minor residual: ~1-2s cold race on simultaneous dupes — fine for
    Twilio's spaced retries.)
  - **DLQ (live, tested):** **`errHandler01`** ("Relentless AI - Error Handler (DLQ)") = Error Trigger →
    formatError (PII-redacted) → write `tbl_dead_letter`. Set as the **Error Workflow on all 5 production
    workflows** (inbound, briefing, EoD, nudge, feedback). Verified: an induced failure writes a row.
  - **New Airtable tables** (client_test base): `tbl_inbound_seen` (`tbl29Je265sMgO66w`),
    `tbl_dead_letter` (`tblGJjCiX0AFpZtJl`). Created via Meta API (token now has `schema.bases:write`).
  - **Build scripts** (rebuild/reapply): `build/n8n/_build_hardened.py`, `_build_dlq.py`, `_wire_dlq.py`
    (+ `_test_hardened.py`). Two deactivated test workflows remain (`dbgInbound01`, `dlqTest0001`) — safe
    to delete in the UI.
  - **VERIFIED 2026-06-13:** hardened inbound (`inbHardenedV1`, path `/webhook/twilio-inbound`, active)
    proven end-to-end — valid signed request → 1 `tbl_inbound_seen` row; **bad signature → dropped (0)**;
    **duplicate MessageSid → no 2nd row**. The fix was using **`$env.TWILIO_AUTH_TOKEN`** (the JS Task
    Runner does NOT inherit `process.env`). DLQ (`errHandler01`, active) **proven** — it captured a real
    inbound failure into `tbl_dead_letter` with phone-redaction + `status=new`. Test scripts:
    `build/n8n/_test_hardened.py`, `_test_dlq.py`; throwaway `dlqTest0001` left inactive.
  - ✅ **N-BACKOFF done (2026-06-13):** all external nodes (HTTP/Claude, Twilio, Airtable) in the 4
    scheduled senders (briefing `D6u7ItI5CjwOlW75`, EoD `ZgR4RSOdn86JsfjV`, nudge `0EAKsIekNAOKYmQH`,
    feedback `xRaDYtW7kySPKQjO`) now have n8n retry-on-fail (`maxTries:3`, `waitBetweenTries:2000ms`) —
    applied via `build/n8n/_add_backoff.py` (senders are inactive, so no live-path risk). Note: n8n's
    built-in retry is fixed-interval, not true exponential; good enough for transient 429/5xx.
  - ✅ **Execution-data retention/pruning done (2026-06-13):** n8n container recreated with
    `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 days), `EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000`
    so PII-bearing execution logs don't accumulate (privacy P1). Full run cmd now also carries those + the
    `TWILIO_AUTH_TOKEN` + `NODE_FUNCTION_ALLOW_BUILTIN=crypto` envs. Inbound webhook re-registered + live (200) after restart.
  - **Still open (lower priority):** web task `sync_status`/reconcile sweeper (minor — tasks already work
    in Supabase regardless of GHL); true exponential backoff + `Retry-After` honoring (would need custom Code nodes).
  - ⚠️ **SMS send caveat:** the captured DLQ error was a Twilio "Bad request" — but that test used a
    Twilio *magic* recipient (`+15005550006`) which live credentials reject, so it does NOT prove the
    SMS sender is broken. Real SMS delivery still needs a provisioned SMS number + verified/real
    recipient (trial India↔US block + A2P 10DLC still apply).

✅ **Senior-Dev-Review Tier-1 fixes done + deployed (2026-06-17):** correctness/UX fixes from
`SeniorDevReview.md`. (1) **Pro cards now gate on `plan`** — `/api/coaching` returns `plan`; the dashboard
hides Capital/Risk pillars, Stage Intelligence, and War Room KPI for non-pro (no fake numbers shown to
Standard). (2) **Char limit reconciled to 280** (promptAssembler.js + test; matches live briefing). (3) The
stale `build/n8n/_buildBriefing_live.js` artifact was **re-synced from the deployed `briefing_intensity.json`**
— it now correctly contains the inlined `computeIntensity`/`TASK CALIBRATION`. ⚠️ NOTE: the review's #1
finding ("intensityCalibration not inlined") was based on that stale on-disk file — the feature **was** live
in n8n; the artifact is now fixed too. (4) tasks-sync `dueDateTodayISO` honest comment (23:00 UTC). (5)
onboarding uses Supabase error `code` `42P01` not string-match. (6) dashboard uses `useState(()=>createClient())`
(consistent). (7) **`GET /api/health`** public liveness probe (build/region + integration booleans). (8)
**same-origin CSRF guard** (`src/lib/csrf.ts`) on profile-sync + tasks-sync POSTs. (9) root **`.env.example`**
for the n8n container env. Build green, deployed to prod, smoke-tested (health returns JSON; routes guarded).

✅ **Daily loop ACTIVATED + delivery-tracking & heartbeat shipped (2026-06-17):** the 4 scheduled
senders had been sitting **INACTIVE** (no daily loop was actually running). Activated all 4 — Morning
Briefing (`D6u7ItI5CjwOlW75`), End-of-Day Score (`ZgR4RSOdn86JsfjV`), Nudge Engine (`0EAKsIekNAOKYmQH`),
Feedback Question (`xRaDYtW7kySPKQjO`) — now **all active + verified firing on schedule** (briefing +
nudge executions logged today). Two NEW production workflows built, imported, active, verified:
  - **`statusCallback01`** ("Relentless AI - Twilio Status Callback", path **`/webhook/twilio-status`**):
    Webhook (respond-200-first via Respond node) → parseStatus → IF failed/undelivered → write
    `tbl_dead_letter`. **Verified live:** `delivered` → success no-op (exec 262/264 success); `failed`
    → DLQ row written. ⚠️ Closes the "sent ≠ delivered" gap. **Still TODO:** wire the StatusCallback URL
    into the 4 senders' Twilio nodes (`build/n8n/_add_status_callback.py` patches them — but set
    `CALLBACK_URL` to the PERMANENT host URL first, not ngrok). Twilio also needs the StatusCallback
    configured, which only matters once real SMS sends to real US numbers.
  - **`heartbeat01`** ("Relentless AI - Heartbeat / SLA Monitor", schedule **6:15 AM Mon-Fri**
    `Asia/Kolkata`): searches `tbl_briefings` for today's row; if missing → DLQ row + Twilio alert SMS to
    operator (+916355046464). Built + active; alert path will be confirmed during the soak on the
    permanent host (today it's a no-op success since the briefing ran).
  - ⚠️ **DLQ schema gotcha (learned the hard way):** `tbl_dead_letter` fields are
    **`workflow, error, payload_redacted, client_id, ts, retry_count, status`** — NOT `workflow_name`/
    `error_message`. Both new workflows initially failed with Airtable `422 UNKNOWN_FIELD_NAME` until
    corrected. Source files: `build/n8n/status_callback_wf.json`, `heartbeat_wf.json`.
  - ⚠️ **n8n CLI activation quirk (re-confirmed):** `import:workflow` + `update:workflow --active=true`
    leaves `activeVersionId=null`, so the webhook does NOT register on the next boot. Fix that worked:
    deactivate→reactivate via CLI, restart, then **retry the first POST 2-3× — registration lags ~10-15s**.
  - ✅ **HOSTING DONE — migrated to Hetzner 2026-06-19:** n8n now runs 24/7 on a **Hetzner cx23** VPS
    (id `142978412`, IP `167.233.94.171`, Nuremberg, ~€6.49/mo gross; CX22 was renamed→cx23). Permanent
    HTTPS via **Caddy + Let's Encrypt on `https://167.233.94.171.nip.io`** (no domain bought; replaces
    ngrok). The whole `n8n_data` volume was migrated, so the **encryption key + all 14 workflows + all
    credentials came over intact** — verified: all active workflows re-activated on boot, public TLS valid,
    inbound + status webhooks return 200. Laptop n8n is STOPPED (don't restart → avoids double-sends).
    Full runbook + SSH key + compose files: `build/n8n/hetzner/` (`HETZNER-MIGRATION.md`). ⚠️ Follow-ups:
    rotate the Hetzner API token (pasted in chat); re-point Twilio webhooks to the new URL; wire the
    StatusCallback URL into the 4 senders; disable the ngrok auto-start launcher. A2P is registered in
    **GHL** (Twilio = fallback only; trial credits fine for fallback). Decision doc: `build/n8n/N8N-HOSTING-DECISION.md`.
  - **Supabase RLS SQL ready** (`build/n8n/supabase_rls.sql`) — user must run it once in the Supabase SQL
    editor (profiles/tasks/meetings own-row policies). Cannot be applied from here.

✅ **Pro-tier + War Room FOUNDATIONS built as tested pure-logic modules (2026-06-17):** the hard,
verifiable cores are done (the n8n workflows that wire them need the permanent host + missing tables +
a real Pro client to go live — see "blocked" note). All in `build/harness/scoring/`, same pure-function
pattern as `scoring.js`:
  - **`warRoom.js` (45 tests)** — Phase 9 War Room state machine: session-type routing
    (PROBLEM/OPPORTUNITY/STRATEGY), 5-phase progression (context→diagnosis→reason→close→done), confidence
    gates (REFLECT retry <0.8 capped at 2; DEEP escalation <0.7; close-retry <8/10), follow-up parse
    (YES/NO/DEFER), recurring-pattern detection (theme 3+ in 28d), high-usage flag (10+/mo), the 3×4
    session-type prompt sets, and the canonical Claude system prompt. Spec §12.
  - **`pendingReplies.js` (20 tests)** — the §5.0.5 inbound state machine: deterministic 3-tier match
    precedence (in-progress sequence by index → latest single-shot whose answer-shape fits → newest
    free-text), tie→unmatched, expiry helper. This is the backbone the multi-turn features (War Room,
    weekly health ×5, manual biometrics ×3, feedback) all share.
  - **`monthlyAggregation.js` (15 tests)** — Phase 6 monthly report aggregation: base_score + the three
    bonuses (trend 0-5, consistency 0-3, pillar-improvement 0-4 — formulas PINNED, see file header since
    the plan left them under-specified), peak/recovery-day counts, best/worst day, priority-completion
    rate, Pro capital/risk averages. Feeds the existing `monthlyScore()`.
  - **Pro 6-pillar EoD wired** — `build/n8n/_build_eod_pro.py` produces **`_eod_pro.json`** (new id
    `eodPro00001`): adds a tolerant `fetchBusinessHealth` Airtable node + a patched `computeScore` that,
    for `plan='pro'`, computes Capital/Risk (inlined from scoring.js) → `compositePro` and appends them to
    the SMS; Standard stays the unchanged 4-pillar path. **Verified offline** (`_sim_eod_pro.js` + a
    mock-`$()` harness run): Standard composite = **78 (parity with the live EoD)**; Pro w/ healthy
    business-health = 82 (Cap 85, Risk 80); Pro w/o data = neutral 70/70. **Updated 2026-06-18:** now reads
    the STORED `capital_score`/`risk_score` from `tbl_business_health` first (the Weekly Health check-in
    writes those), falling back to compute-from-cash_position, then neutral 70. Re-verified offline against
    the real seeded demo_pro business_health row (capital_score 85, risk_score 80 → composite **82 Strong**,
    full 6-pillar SMS). Imported to n8n as `eodPro00001` (INACTIVE — it's a separate Pro variant; its
    "Search records" profile loader still targets the single client, so to demo the Pro SMS either point it
    at demo_pro or use the dashboard as the Pro-score surface). Seeded `tbl_business_health` row for demo_pro
    = `rec1IbvFBXBhWjoQb`.
  - ⚠️ **What's still BLOCKED (not built) and why:** the remaining n8n *workflows* — 7-day onboarding
    sequence, Weekly Business Health check-in (WF7), Monthly Report sender (WF6), Stage-transition (Mon
    6:30) + Bad-day override (Mon 8:30), and the War Room n8n workflow that wires `warRoom.js` — all (a)
    send real SMS (gated on the permanent host + Twilio/A2P being live to a real recipient), (b) need
    tables that don't exist yet (`tbl_business_health`, `tbl_war_room_sessions`, `tbl_monthly_reports`,
    `tbl_pending_replies`), and (c) can't be end-to-end verified without a live host + a real Pro client.
    Building them now = unverifiable JSON that will need re-pointing after the host move. **Correct
    sequence:** pick host → migrate n8n → create the 4 tables → wire status-callback URL → then build
    these workflows on the live host (the tested modules above drop straight in).

✅ **DEMO build — War Room n8n workflow LIVE + tables created (2026-06-18):** building toward a full
demo (daily loop + dashboard + Pro + War Room), runnable on the laptop now.
  - **`tbl_war_room_sessions` created** (id `tblhCNFTPM9NevFuz`) in the client_test base via
    `build/airtable/_demo_tables.py` (reads the Airtable PAT from `relentless-web/.env.local`, never
    prints it; idempotent — skips existing). All other Pro tables (`tbl_business_health`,
    `tbl_monthly_reports`, `tbl_market_signals`) already existed.
  - **War Room workflow** `build/n8n/_warroom.json` (generator `_build_warroom.py`, id `warRoom0001`,
    path **`/webhook/war-room`**): stateful multi-turn session — Webhook → loadProfile (plan gate) →
    loadSession (active row = `committed_action` empty) → **routeTurn** (inlines `warRoom.js`: classify
    type, phase machine, phase persisted in `focus_topic` since schema has no phase col) → IF needsClaude
    → callClaude (Anthropic, header-auth cred `pcypOWLM78lgbOUQ`, `claude-sonnet-4-6`) → afterClaude
    (parses `ACTION: … | CONFIDENCE: N`; REFLECT retry if <8; close if ≥8) → buildSessionPatch → IF
    persist → upsert `tbl_war_room_sessions` → Respond(JSON). **Curl-testable end-to-end (no SMS needed)
    — demos in a terminal.** Verified OFFLINE via mock harness: WAR ROOM→type→describe→probe→synthesize
    correctly extracted a committed action + confidence 0.9 + closed. ⚠️ LIVE import/activation was
    **LIVE + VERIFIED END-TO-END (2026-06-18)** on the laptop: ran full PROBLEM and OPPORTUNITY
    sessions via curl with real Claude calls — standard client → Pro-gate; Pro client (`demo_pro`) →
    "War Room activated, Demo CEO" → type → Claude first-principles diagnosis + ONE probing question →
    synthesize + committed 24h action + confidence 0.9 → row written to `tbl_war_room_sessions` with
    correct `session_type` (problem_solving / opportunity_mapping), committed_action, final_confidence,
    action_due_date. Bugs fixed during bring-up: (1) loadProfile filtered client_id by phone (→ now
    `{phone_number}=From`); (2) loadSession hardcoded client_test (→ `{committed_action}=''`, routeTurn
    filters by CID); (3) double-mapping of session_type (problem→problem_solving→strategic_review) made
    idempotent via `rawType()`. ⚠️ curl gotcha: URL-encode `+` in From (`--data-urlencode` or `%2B`) or
    it's read as a space. Webhook-registration lag after restart is ~15-30s — retry the first POST.
  - **Pro demo profile** created (NOT touching live client_test): `tbl_client_profile` row
    `client_id=demo_pro`, `plan=pro`, `phone_number=+15551239999` (`recfpTB63hcuoFE6Q`), via
    `build/airtable/_demo_pro_profile.py`. This unlocks the Pro War Room + (once wired) the Pro dashboard.

✅ **ALL next-phase features built + LIVE + verified (2026-06-18)** — full daily+weekly+monthly loop now
runs end-to-end; real SMS sent to the operator (+916355046464, set on client_test; outbound to +91 limps
through, inbound still blocked). Generators + JSON in `build/n8n/`:
  - **7-Day Onboarding** (`onboard00001`): daily 6:30; reads/advances `onboarding_day`; Claude writes the
    day's themed message. Verified day 1→2→3.
  - **Weekly Business Health (Pro)** (`weekly000001`): Sun 19:00, Pro-gated cash/risk/team check-in.
    Reply→capital/risk extraction is the inbound half (uses `pendingReplies.js`; not demoable on +91).
  - **Monthly Report** (`monthly00001`): 1st 08:00; inlines `monthlyAggregation.js`+`monthlyScore`; logs
    `tbl_monthly_reports`. Verified ("May: Score 74/100. June focus: priority completion >75%...").
  - **Stage/Weekly Plan** (`stageTrans01`, Mon 6:30) + **Bad-Day Override** (`badDayOverr1`, Mon 8:30,
    gates on a rough prior week — verified it skips on a good week). Both verified live.
  - **Pro 6-pillar EoD** (`eodPro00001`) is now the ACTIVE evening score; old 4-pillar `ZgR4RSOdn86JsfjV`
    DEACTIVATED (no double send). Reads stored capital/risk from `tbl_business_health`. ⚠️ fixed a
    `fetchBusinessHealth` bug (sorted by non-existent `date` field → neutral 70/70; sort removed → real
    **Capital 85, Risk 80** live). client_test set **plan=pro** + business_health seeded, so the operator's
    phone AND dashboard show the full Pro experience. **14 workflows active**; 3 webhooks re-registered (200).
  - ⚠️ **Hetzner deploy NOT done:** Claude-in-Chrome had no paired browser, so browser-driven setup couldn't
    run. Cleanest path: a Hetzner Cloud **API token** → scripted server create + cloud-init (Docker+n8n) from
    Bash, then migrate the `n8n_data` volume; fallback is `build/n8n/N8N-HOSTING-DECISION.md`.

✅ **Dashboard professional redesign + Capital/Risk removed from UI + DEPLOYED (2026-06-18):**
`relentless-web/src/app/dashboard/page.tsx` + `globals.css`. Per user: "leave the n8n capital/risk for now,
finish the dashboard." Changes: **Capital & Risk stripped from the UI** (score pillars, trend day-breakdown,
Business Health card metrics, PILLAR_INFO explainers) → clean 4-pillar Standard (Body/Focus/Execution/
Alignment). Professional light polish — refined tokens (`--line:#ececec`, `--bg:#f6f6f4`, calmer `--muted`),
**flat band-colored trend bars** (gradients removed: green `#5fd0a0` / gold `#d4af3c` / amber `#f0c896`), and
a top-bar **plan chip + avatar**. The dashboard was already real-time (polls `/api/coaching` every 30s, Live/
Paused toggle) + interactive (task CRUD + GHL sync, voice-to-task, meetings, score/pillar popovers, trend
breakdown, War Room slide-over → `/api/warroom`). `npx next build` green (14 routes). **DEPLOYED to prod**
(`vercel deploy --prod --scope dwayne-s`, user-authorized; deployment `relentless-69y1gu29d`, READY, region
iad1) — live at https://relentless-web.vercel.app; smoke-tested (login 200, dashboard 307-guards, health ok).
Local dev also running at http://localhost:3003. ⚠️ Note: the dashboard composite still reflects whatever the
active EoD writes (Pro 6-pillar `eodPro00001` is active + `client_test` is plan=pro from the demo) — the UI
simply no longer *renders* Capital/Risk. Reverting the EoD/score to 4-pillar was deferred by the user.

✅ **Web War Room gate fixed + Market Intelligence added + redeployed (2026-06-18):**
  - 🔑 **DISCOVERY: a Hetzner n8n is already LIVE at `167.233.94.171.nip.io`** and is what the PROD web app
    targets for War Room (`N8N_WARROOM_URL` default in `src/app/api/warroom/route.ts`). It has a working
    war-room webhook (verified: returns "War Room activated, Demo CEO" for the demo_pro phone, reads the
    shared cloud Airtable). So n8n is PARTLY migrated to Hetzner already. ⚠️ But the NEW workflows
    (market/monthly/onboarding/weekly/stage/badday/statusCallback/heartbeat/Pro-EoD) were built on the
    **localhost** n8n — they are NOT on the Hetzner instance yet. Full prod parity needs them imported to
    Hetzner (need its n8n API key / SSH — still no access from here).
  - **War Room "Pro feature" bug FIXED:** `/api/warroom` gated on the **Supabase** `ctx.plan` (which is
    standard/null for the logged-in user) while `/api/coaching` reads `plan` from **Airtable** (pro) — they
    drifted. Rewrote `/api/warroom` to fetch the client's Airtable profile (it already did, for the phone)
    and gate on the **Airtable `plan`** instead. Now consistent with coaching + the n8n backend. Built green,
    **redeployed to prod** (`relentless-jtxrgv3pl`, aliased to relentless-web.vercel.app). Verified the
    Hetzner chain engages for client_test (+916355046464, pro). ⚠️ A stale open war_room session from testing
    lingers (attempted cleanup delete was classifier-blocked as destructive on shared data) — harmless; the
    first "WAR ROOM" may continue the old session. Delete the open `tbl_war_room_sessions` rows (committed_action
    empty) in the Airtable UI for a perfectly clean first turn.
  - **Market Intelligence (Phase 8) added:** `/api/coaching` already read `tbl_market_signals` + the dashboard
    renders the Market Signal card (Pro) — it was just empty. Seeded a real signal row for client_test
    (`rec6LF34U5KQpoEtv`) so the card shows now, and built **`build/n8n/_market.json`** (gen `_build_market.py`,
    id `market000001`): 5:40 AM Pro-gated, Claude generates an industry-specific signal from
    `industry`/`market_keywords` → writes `tbl_market_signals` (degrades gracefully w/o a NewsData key; wire
    NewsData.io later by prepending a fetch). Built; import to the Hetzner n8n to schedule it.

✅ **SMB Growth Diagnostic — BUILT + DEPLOYED (2026-06-18):** from `smb diagnostic.pdf`. A public
9-question lead-gen funnel ("Find out exactly why your business isn't growing") → scored, per-area
diagnosis + 3 specific fixes + lead capture. Plan for both new PDFs: `reference/NEW-FEATURES-PLAN.md`.
  - **Files:** `relentless-web/src/lib/diagnostic.ts` (9 questions across pricing/leadflow/sales/
    retention/marketing/operations/finance/team/focus; deterministic scoring 0-27 + per-area diagnosis
    engine — no external AI key needed; a Claude narrative pass can layer on via n8n later),
    `src/app/diagnostic/page.tsx` (stepped quiz → result → lead form, on-brand light/gold design,
    `.diag-*` CSS in globals.css), `src/app/api/diagnostic/route.ts` (public, same-origin-guarded,
    writes lead to Airtable `tbl_leads`). `/diagnostic` + `/api/diagnostic` added to `proxy.ts`
    PUBLIC_PATHS.
  - **New Airtable table** `tbl_leads` (`tblXJ9AY17WdRwP40`): name/email/phone/business_type/total_score/
    top_constraint/answers_json/diagnosis/source/created_at/status.
  - **LIVE:** https://relentless-web.vercel.app/diagnostic (public, no auth). Build green, deployed
    (`relentless-i83hiwiab`, aliased). Verified: page 200, lead POST writes a row (`recTI9Vlb0Nrz1GXM`
    test lead — delete from tbl_leads if cleaning up).
  - ⚠️ **Feature 1 (6-source Morning Briefing) — PLANNED not built.** See `reference/NEW-FEATURES-PLAN.md`:
    buildable-now subset = CRM/GHL (stalled deals/new leads) + Calendar (Supabase meetings) + News (reuse
    market000001) folded into the briefing assembler. BLOCKED on per-client OAuth: Email (Gmail), Slack,
    real Sales/revenue (Stripe). Needs those creds from the user before building the blocked sources.

✅ **Recurring weekly tasks + GHL-SMS migration prepped (2026-06-18):**
  - **Recurring executive tasks (everyone):** `dashboard/page.tsx` auto-seeds 5 weekly exec tasks (review
    numbers / work pipeline / set top-3 / 1:1s / deep-work block) **once per ISO week** (idempotent via a
    `Weekly · <weekKey>` marker in `meta` + a localStorage guard), mirrors to GHL. Edit the `RECURRING_TASKS`
    array to change them. Deployed.
  - **SMS → GHL migration:** user wants off Twilio (trial-account prefix). **GHL SMS PROVEN to deliver** to
    the +91 test number (international bypasses A2P) via `POST services.leadconnectorhq.com/conversations/
    messages {type:SMS, contactId, message}`. ⚠️ **GHL A2P 10DLC registration FAILED** (Trust Center) — must
    be resubmitted for real US clients (international demo works without it).
  - **New GHL token** `pit-350beac0-738f-4646-a098-28f6fff30a1c` is VALID (old one was dead → caused the
    403/1010 + broke task-sync). Updated in `relentless-web/.env.local` + **Vercel prod** (redeployed
    `relentless-chn0z7f31`) → **task-sync restored**. ⚠️ The n8n **`GHL Relentless` credential still has the
    OLD token** — must be updated in the n8n UI (Step 1 of the guide).
  - **Senders converted to GHL:** `build/n8n/_convert_ghl.py` swaps each Twilio node → a GHL HTTP node
    (contactId from `profile.ghl_contact_id`, auth via `GHL Relentless` Header-Auth cred + `Version:
    2021-04-15`). Output: `briefing_intensity_ghl.json`, `_eod_pro_ghl.json`, `_monthly_ghl.json`,
    `_weekly_ghl.json`, `_onboarding_ghl.json`, `_stage_ghl.json`, `_badday_ghl.json`. Still on Twilio
    (convert later — need their JSON / n8n access): Nudge, Feedback, Inbound reply, War Room reply.
  - ⚠️ **n8n public API DISABLED on Hetzner** (`167.233.94.171.nip.io`): both API keys return 401 though the
    editor loads (200). So workflow deploys to Hetzner must go via **UI import**, not the API. Step-by-step:
    `build/n8n/GHL-SMS-SWITCH-GUIDE.md` (update credential token → import the 7 `*_ghl.json` → activate GHL
    versions / deactivate Twilio versions → test).
  - **Demo runbook:** `build/n8n/DEMO-RUNBOOK.md` — click-by-click for all 4 demo pieces + the curl
    recipes + the US-number SMS caveat (inbound from +91 is carrier-blocked; use a US/Google-Voice number
    or demo over curl).
  - ⚠️ **For the Pro/dashboard demo:** set the demo profile `plan=pro` + add one `tbl_business_health`
    row, and import/activate `_eod_pro.json`, so Capital/Risk show real numbers.

✅ **W3 Multi-tenant — link is now safe to share (2026-06-13):** the API routes derive the tenant from
the **signed-in user's profile**, not env vars. New: `src/lib/clientContext.ts` (`getClientContext()`
reads `profiles.client_id / airtable_base_id / ghl_contact_id / plan`). `/api/coaching` reads the user's
own base + **caches per-base** (a user can never be served another tenant's cached data) and returns
`{configured:false, reason:"not_provisioned"}` when the user has no client → dashboard shows a "not set up
yet" banner + sample data only (no real leak). `/api/profile-sync` + `/api/tasks-sync` likewise use the
profile's client/base/ghl-contact. SQL run (via browser): added 4 columns to `profiles` + mapped existing
rows to `client_test` (verified: both Stuti rows → client_test / appjnWxg9sB3PV7Da / v8lIYQuHTAcLFmbJ0HUt).
Deployed to prod + smoke-tested. ⚠️ Still TODO for a REAL 2nd client: clone the Airtable TEMPLATE base +
register the new client + set that user's `client_id`/`airtable_base_id` (per `relentless-web/PLAN/
03-multi-client-mapping.md`). The env vars `AIRTABLE_BASE_ID`/`AIRTABLE_CLIENT_ID`/`GHL_CONTACT_ID` are now
unused by the app (left in place, harmless).

✅ **Web app DEPLOYED to Vercel (2026-06-13):** live at **https://relentless-web.vercel.app**
(deployment `relentless-8juqyx2c2-dwayne-s.vercel.app`, project `dwayne-s/relentless-web`,
id `prj_DroCH02c7yx5AIH0VsHMxuvEti6R`). Deployed via **Vercel CLI** (`vercel deploy --prod --scope
dwayne-s`) — no GitHub needed; CLI uploads the dir, `.gitignore` keeps `.env*` out. All 8 env vars set
in Vercel production (Supabase URL/anon, Airtable token/base/client, GHL token/loc/contact). Build green,
all routes + proxy live; smoke-tested (`/login` 200, protected routes 307). **Supabase Auth URL config
DONE (2026-06-13, via browser):** Site URL = `https://relentless-web.vercel.app`, Redirect URLs allowlist
= `https://relentless-web.vercel.app/**` (Total URLs: 1) — so prod email/password login, new-signup email
confirmation, and Google OAuth all redirect correctly. Prod auth is fully functional. App is still **single-tenant** (one hardcoded `client_test`) — do
not share the public link widely until W3 multi-tenant lands. Vercel token is the user's (account
`digitaldadateam-2917` / scope `dwayne-s`).

✅ **WhatsApp → SMS shift (2026-06-13):** ALL Twilio nodes across all workflows now send plain **SMS**
(`from=+14482429365`, `toWhatsapp` removed) — converted via `build/n8n/_convert_sms.py` (only the inbound
reply still needed it; briefing/EoD/nudge/feedback were already SMS). Hardened inbound `inbHardenedV1` is
active on the production path `/webhook/twilio-inbound` (signature + idempotency guards live). The inbound
router strips `whatsapp:` defensively, so plain-SMS `From` works unchanged. ⚠️ **Still required for live
inbound SMS:** in the Twilio console, point the **+14482429365** number's "A MESSAGE COMES IN" webhook to
the public n8n URL (ngrok + `/webhook/twilio-inbound`), and ensure ngrok is running. Trial-account SMS
limits (India↔US block, A2P 10DLC for US) still apply. Inventory tool: `build/n8n/_inventory_twilio.py`.

✅ **Energy → task-intensity calibration in the Morning Briefing (2026-06-12):** new tested module
`build/harness/scoring/intensityCalibration.js` (`computeIntensity(recovery, energy)`, **11 tests**) is
**inlined into the `buildBriefing` node** (workflow `D6u7ItI5CjwOlW75`). It replaces the old crude
`recovery<60`/`recovery>80` lines with a deliberate 3-tier calibration injected into the Claude system
prompt: **low** (recovery <45 OR energy ≤2) → one light keystone + admin, defer high-stakes; **moderate**
(45-69 / energy 3) → 2-3 normal priorities; **high** (≥70 / energy ≥4) → front-load the hardest work.
Energy (manual 1-5) is a downward override (low energy always lightens the day, even on good recovery);
strong energy can lift a decent day; a wrecked recovery stays low regardless. The multi-day
`computeAdaptation` streak still takes precedence when active. Verified offline across low/steady/high/
conflict scenarios (`build/n8n/_sim_briefing.js`). Thresholds/wording live in the module — easy to tune.
Briefing workflow remains **inactive** (unchanged); activate to schedule. Patch/build scripts:
`build/n8n/_patch_briefing.py`, `_buildBriefing_live.js`.

✅ **Hetzner prod-parity confirmed + Market Intelligence imported (2026-06-20):** verified the live
Hetzner n8n (`167.233.94.171.nip.io`) directly via the **SSH key** (`build/n8n/hetzner/ssh/n8n_hetzner`,
`docker compose exec n8n n8n list:workflow`) — **the 06-19 volume migration already carried EVERY
workflow over** (monthly/stage/badday/onboarding/weekly/warRoom/eodPro/statusCallback/heartbeat all
present + ACTIVE, with the SAME credential IDs — so the earlier "they're localhost-only / need cred
remap" worry was moot). The **only** gap was **`market000001`** (`_market.json`) — it had only ever
been generated to disk, never imported anywhere. Imported it via the CLI (`import:workflow` keeps the
`id`, unlike the public API), activated, restarted n8n; verified **active** + webhooks 200. The
Hetzner **public REST API key still 401s** (`%TEMP%/hn8n_key.txt` decodes as a valid no-expiry n8n
public-api JWT that the server rejects — revoked/foreign key), but it's **moot**: the SSH path is the
reliable management channel and needs no API key. ⚠️ Don't re-import the other `_*.json` to Hetzner —
the live versions are authoritative; disk copies may be stale.
  - **Active prod set on Hetzner (16):** Morning Briefing, Nudge, Feedback, Inbound HARDENED, DLQ,
    Status Callback, Heartbeat, War Room, **Pro EoD** (old 4-pillar `ZgR4RSOdn86JsfjV` inactive),
    Monthly, Stage Transition, Bad-Day, Onboarding, Weekly Health, **Market Intelligence (new)** (+ a
    `Thiago` workflow that belongs to another client). Old inbound `Y3Zyg…` correctly inactive.

✅ **Meeting reminders — LIVE + VERIFIED on Hetzner (2026-06-20):** root cause was that meetings live in
**Supabase** (`meetings`: `id,title,meet_time,user_id`) and n8n had no Supabase access. Fixed:
  - **`meetReminder1`** ("Meeting Reminders (3 min)", gen `build/n8n/_build_meetings.py` → `_meetings.json`,
    **ACTIVE**). Every-minute cron → `computeWindow` (fetch `reminder_sent_at IS NULL`) → `getMeetings`
    (Supabase REST) → `splitMeetings` (parses **`meet_time` = bare "HH:MM"** as today in container TZ;
    keeps meetings due in ≤3 min) → `getProfile` (user_id→client_id) → `getPhone` (Airtable
    `phone_number`) → `buildSms` (plain-ASCII ≤160) → IsSend → Twilio (`onError:continue` = no retry
    storm) → `markSent` (PATCH `reminder_sent_at`, dedup). **20/20 offline checks** (`node _sim_meetings.js`).
  - **Wiring:** Supabase **service_role** key added to `/root/n8n/.env` as `SUPABASE_SERVICE_KEY` +
    `docker-compose.yml` `environment:` line; key read via `$env.SUPABASE_SERVICE_KEY` (not in JSON).
    `reminder_sent_at timestamptz` column added (`build/n8n/meetings_reminder.sql`, user ran it).
  - **Verified live:** inserted a meeting 2 min out → `reminder_sent_at` stamped ~1 min before, chain ran
    end-to-end (found→phone→send→dedup). Test rows cleaned up. ⚠️ Real SMS to +91 only limps (trial);
    US clients deliver normally. Timing **3 min** (user's call); dashboard/onboarding copy reconciled to
    "3 minutes" (`dashboard/page.tsx:882`, `onboarding/page.tsx:9` — **needs a Vercel redeploy to show**).
    Multi-tenant TODO: Airtable base + meet_time tz are hardcoded to client_test / container-local.

✅ **War Room "(no response)" bug FIXED + deployed (2026-06-20):** user hit repeated "(no response)" mid-
session. Root cause: `callClaude` had `onError:stop`, so a malformed Anthropic `messages` array (an
empty-content turn creeping in during the REFLECT loop) **killed the workflow before the Respond node**
→ web got no `{reply}`. Also `afterClaude` emitted `reply:''` + a phantom close on empty Claude text, so
the session never closed and every retry repeated. Fixes in `_build_warroom.py` (→ `warRoom0001`,
re-imported + reactivated): (1) **`buildMsgs()` sanitizer** — drops empty turns, enforces user-first +
merges consecutive same-role (prevents the 400); (2) **`callClaude onError:continueRegularOutput`**;
(3) **`afterClaude` empty-guard** — returns a safe retry reply, never `''`, never a phantom close;
(4) **synthesize prompt hardened** + **`confidence==null` branch** so it reliably emits/commits the
`ACTION | CONFIDENCE` line instead of looping on questions; (5) clean strip of the structured line from
the client SMS. **Verified live** (PROBLEM/STRATEGY full sessions via curl): every turn replies, reaches
"Committed: <action> (within 24h)", no empty responses. ⚠️ A stale open demo_pro session
(`recTaqLZriMv7myRk`, committed_action empty) still lingers — Airtable cleanup is the user's UI task.

🏗️ **IN PROGRESS — Two-Way Conversational Intelligence (Phase 1 backbone, started 2026-06-22):**
turning the one-way broadcaster into a two-way intelligent coach. **Approved design spec:**
`docs/superpowers/specs/2026-06-20-two-way-conversational-intelligence-design.md` (read it for the full
plan). Architecture = a central **Conversation Engine**: a `tbl_pending_replies` table (short-term
"what did I ask" memory) + ONE **GHL Inbound Router** (dispatch: War Room → pendingReplies.js match →
free-text fallback; Claude writes every reply). 4 phases: (1) backbone, (2) 2-step mood-aware morning,
(3) honest scoring, (4) rich synthesis + War Room fold-in. **User decisions:** channel=GHL;
morning=2-step; every reply=LLM; scoring=honest/transparent; **morning briefing carries NO capital/risk
for Pro (EoD-only).**
  - **GHL wiring facts (confirmed 2026-06-22):** outbound senders already converted to GHL on disk
    (`build/n8n/_*_ghl.json`). **GHL send pattern:** `POST services.leadconnectorhq.com/conversations/messages`,
    headers `Version: 2021-04-15` + `Content-Type: application/json`, auth = GHL header-auth cred
    `fLewYZwvD9PfMAQJ` ("GHL Relentless", `Authorization: Bearer pit-…`), body
    `{type:'SMS', contactId:<ghl_contact_id from Airtable profile>, message:<reply>}`. **GHL inbound does
    NOT exist yet** — needs a GHL automation ("Customer Replied"→Webhook→n8n `/webhook/ghl-inbound`); the
    n8n side gets built here, the GHL automation is a user UI step (steps provided when ready).
  - **Phase 1 progress:** Reusable engine `build/harness/scoring/pendingReplies.js` (20 tests) is the
    matcher. ✅ `tbl_pending_replies` table CREATED (id **`tblF6cmCv6TMWNsNF`**, client_test base, via
    `build/airtable/_create_pending_replies.py`): fields `pending_id, client_id, expected_type,
    context_ref(JSON), opened_at, expires_at, status(open/matched/expired), ghl_contact_id,
    inbound_msg_id, matched_reply`. ✅ **`voice.js` built + tested** (13 checks) — shared personality
    (`voiceSystem({name,stage,situation,maxChars})`) + centralized `sanitizeSms()` (one consistent voice
    across every Claude call). ✅ **GHL Inbound Router built** (`build/n8n/_build_ghl_inbound.py` →
    `_ghl_inbound.json`, id **`ghlInboundV1`**, path **`/webhook/ghl-inbound`**, 18 nodes, INACTIVE on
    disk): Webhook(+shared-secret `$env.RELENTLESS_WEBHOOK_SECRET`+idempotency on GHL msg id via
    tbl_inbound_seen) → loadProfile(by ghl_contact_id) → loadPending/loadWarRoom → **dispatch** (inlines
    matchReply+voice: WAR ROOM/active-session → forward to `/webhook/war-room`; else pendingReplies match
    → contextual Claude ack + close row; else fallback ack) → sendGHL (conversations/messages). Dispatch
    brain **offline-tested 13/13** (`node build/n8n/_sim_ghl_inbound.js`), incl. sequence precedence.
    ✅ **Weekly check-in now OPENS a conversation** — `build/n8n/_add_open_conversation.py` (reusable
    injector) added an `openConversation` Airtable-create node after the weekly's GHL send
    (`_weekly_ghl.json`, id `weekly000001ghl`): writes a `tbl_pending_replies` row
    (`expected_type=weekly_checkin`, 48h expiry, client_id + ghl_contact_id from profile). This is the
    direct fix for "I replied and nothing happened." Other senders reuse the same script in later phases.
  - ✅ **PHASE 1 LIVE + VERIFIED on Hetzner (2026-06-23).** `ghlInboundV1` (path `/webhook/ghl-inbound`)
    ACTIVE; weekly swapped to GHL (`weekly000001ghl` active, Twilio `weekly000001` deactivated — no
    double-send). GHL inbound automation PUBLISHED by user ("Customer Replied"→Webhook POST
    `{contactId,message,messageId}`). **Verified end-to-end via controlled self-test:** opened a
    `weekly_checkin` row → POSTed a simulated GHL inbound → router matched it (sequence precedence,
    earliest-first), wrote a Claude contextual ack, **closed the row** (status=matched + matched_reply +
    inbound_msg_id) and sent via GHL. Test rows + throwaway debug workflow cleaned up.
  - ⚠️ **Two bugs found + fixed during bring-up (learnings):** (1) **stale war-room sessions hijacked
    inbound** — dispatch now treats a war session as active only if open AND `session_date` < 3h
    (`WAR_ACTIVE_MS`). (2) **closePending Airtable update silently failed** — n8n Airtable v2.2 `update`
    needs `matchingColumns:['id']` + the id inside `columns.value.id`, NOT a top-level `id` param (this
    pattern applies to ALL future Airtable update nodes). Debug technique that found it:
    `build/n8n/_build_ghl_debug.py` (echoes the dispatch decision in the webhook response).
  - ⏳ **Remaining for Phase 1 hardening:** (a) real-world confirm — user texts their GHL number, gets a
    contextual reply (confirms GHL payload field names match the parser + GHL outbound delivery); (b)
    then set `RELENTLESS_WEBHOOK_SECRET` on the container + in the GHL webhook header to lock the endpoint.
  - **Next phases:** P2 = 2-step mood-aware morning; P3 = honest scoring; P4 = rich synthesis (weekly→
    business_health) + War Room fold-in. Reuse `_add_open_conversation.py` to wire EoD-feedback / nudge /
    bad-day / stage / onboarding senders to open conversations.

🏗️ **Phase 2 IN PROGRESS — 2-step mood-aware morning (started 2026-06-23):**
  - ✅ **`morningMood.js`** (15 tests) — `parseMoodReply()` (extract sleep/energy/stress 1-5 from a reply)
    + `moodAssessment()` (bucket low/moderate/high + a TONE directive for the briefing opener; any single
    depletion signal forces "low"). Pairs with `intensityCalibration.js` (task load) — mood owns the
    emotional framing the user asked for.
  - ✅ **Storage confirmed:** `tbl_biometrics` already has `manual_sleep_input/manual_energy_input/
    manual_stress_input` — morning reads map straight in, no schema change.
  - ✅ **Briefing Builder built** (`build/n8n/_build_briefing_builder.py` → `_briefing_builder.json`, id
    **`briefBuilder1`**, INACTIVE): an **Execute-Workflow-triggered** sub-workflow (called by the router on
    a morning_checkin reply with mood, or by the 7:00 fallback without). Reuses the live briefing's proven
    `computeAdaptation`+`computeIntensity` verbatim + adds the `morningMood` opener tone; GHL send; opens a
    `briefing_feedback` conversation. **NO capital/risk** anywhere (stage block + output rules scrubbed).
    Offline-tested **11/11** (`node build/n8n/_sim_briefing_builder.js`): low→energizing+light, high→seize+
    front-load, no-mood→fallback, never mentions capital/risk, adaptation precedence.
  - ✅ **Morning Check-in built** (`_build_morning_checkin.py` → `_morning_checkin.json`, id
    **`morningCheckin1`**, 6:00 cron): Claude warm personal good-morning that asks sleep/energy/stress
    (1-5) in a parseable format → GHL send → opens `morning_checkin` (2h expiry). Tested 6/6.
  - ✅ **Router morning branch wired** (ghlInboundV1, now 23 nodes): dispatch detects matched
    `morning_checkin` → if 3 valid numbers, `mode='morning'` → writeBiometrics (manual_sleep/energy/
    stress) → **execBriefing** (Execute Workflow → briefBuilder1, hasMood) → close row; if not 3 numbers,
    warmly re-asks + keeps the row open. Added `morning_checkin` to `pendingReplies.js` SEQUENCE_TYPES +
    `parseMoodReply` inlined. Router dispatch tests now incl. morning cases (all green).
  - ✅ **Briefing Fallback built** (`_build_briefing_fallback.py` → `_briefing_fallback.json`, id
    **`briefFallback1`**, 7:00 cron): for any still-open `morning_checkin`, Execute briefBuilder1
    (hasMood=false, biometrics-only) + mark the row expired. Never leaves them hanging.
  - **All 11 harness suites green** (incl. new morningMood + updated pendingReplies).
  - ✅ **PHASE 2 LIVE + VERIFIED on Hetzner (2026-06-23).** Active: `morningCheckin1` (6:00 ask),
    `ghlInboundV1` (router w/ morning branch), `briefBuilder1` (mood briefing), `briefFallback1` (7:00).
    Old Twilio standalone briefing `D6u7ItI5CjwOlW75` DEACTIVATED (no double-briefing).
    **Verified end-to-end via self-test:** opened a `morning_checkin` → POSTed "5 4 1" → router stored
    biometrics (manual_sleep/energy/stress) → triggered Briefing Builder → mood-adapted briefing sent +
    `briefing_feedback` conversation opened → morning row closed. Test rows cleaned (table = 0).
  - ⚠️ **Key build decision:** the Briefing Builder is **webhook-triggered** (`/webhook/build-briefing`),
    NOT n8n's Execute Workflow node. The Execute Workflow node silently failed (version/config issue) —
    the morning row closed but no briefing fired. Switched the router morning branch + the fallback to an
    **HTTP POST** to `/webhook/build-briefing` (the proven war-room-forward pattern). Lesson: prefer
    webhook-POST over Execute-Workflow for cross-workflow triggers here. build-briefing is also directly
    curl-testable: `POST {client_id, ghl_contact_id, sleep, energy, stress, hasMood}`.
  - **TODO (Phase 2 hardening):** per-client local-time scheduling for the 6:00/7:00 crons (uses
    `profiles.timezone`; currently Asia/Kolkata) + multi-client loadProfile (currently filters client_test).
    Real-world confirm still pending the user's GHL inbound round-trip (shared with Phase 1's P1-7).
✅ **Phase 3 LIVE + VERIFIED — Honest Executive Score (2026-06-23):** fixes the "fake score" complaint.
  - ✅ **`honestScore.js`** (13 tests): each pillar is `{value, hasData}`; composite = weighted average
    over ONLY pillars with real data, **weights re-normalized**; missing pillars → `null` (shown as `-`);
    `< 2` real pillars → no number (soft note). Weights mirror scoring.js. ⚠️ NB: scoring.js
    `compositePro` weights sum to **1.05** (un-normalized) — honestScore normalizes, so full-Pro scores
    are slightly lower + more correct than the old EoD.
  - ✅ **EoD refactored to honest scoring** (`build/n8n/_build_eod_honest.py` → `_eod_honest.json`, id
    **`eodPro00001ghl`**, ACTIVE): per-pillar hasData — Body from wearable recovery OR **`manualRecovery`
    of the morning sleep/energy/stress reads**; Focus = nudge-response ratio (only if nudges sent, no fake
    block-half); Execution from GHL tasks; **Alignment honestly missing** (no interruptions feed yet → `-`);
    Capital/Risk only with a `tbl_business_health` row. SMS names its coverage + invites YES/NO; quiet day →
    soft note. **Opens a `score_feedback` conversation** so the reaction is matched + acked by the router.
    Offline-tested 13/13 (`node build/n8n/_sim_eod_honest.js`).
  - **Verified LIVE** via an `eod-debug` echo on real client_test data:
    *"Executive Score: 52/100 (Below Par). Based on recovery + focus + priorities + capital + risk. Body 76,
    Focus 0, Execution 43, Alignment -, Capital 85, Risk 80."* — Alignment correctly `-` (not a fake 100),
    Focus honestly 0 (nudges sent, none engaged). Debug workflow deactivated after.
  - **Swaps:** honest GHL EoD `eodPro00001ghl` ACTIVE; old Twilio `eodPro00001` + old Feedback Question
    `xRaDYtW7kySPKQjO` DEACTIVATED (the EoD now owns the feedback ask).
  - **TODO (Phase 3 hardening):** wire a real **Alignment** signal (priority-completion or interruptions)
    so it stops always being `-`; consider softening Focus when nudge-response tracking is sparse.
✅ **Phase 4 LIVE + VERIFIED — Rich synthesis + sender wiring (2026-06-23):**
  - ✅ **Weekly Synthesis** (`build/n8n/_build_weekly_synth.py` → `_weekly_synth.json`, id **`weeklySynth1`**,
    webhook `/webhook/weekly-synth`, ACTIVE): Claude extracts {cash_position, team_health, biggest_risk,
    severity, manageability, deliberate} from the free-text weekly reply AND writes a one-lever synthesis;
    `parseAndScore` computes **capital_score (capitalScore) + risk_score (riskScore)** from scoring.js,
    writes a `tbl_business_health` row (which the honest EoD reads), and sends the synthesis via GHL.
    Tolerant JSON parse (fences/prose), safe enum coercion, fallback synthesis. Offline 11/11
    (`node build/n8n/_sim_weekly_synth.js`).
  - ✅ **Router weekly branch** (ghlInboundV1, now 25 nodes): a matched `weekly_checkin` → `mode='weekly'`
    → POST to `/webhook/weekly-synth` → close the row (no generic ack; the synthesis IS the reply).
    Dispatch order is now WEEKLY → MORNING → WARROOM → pending/fallback. Router tests all green.
  - ✅ **VERIFIED LIVE:** posted *"cash tight, senior engineer hire is the risk, team solo"* → wrote a
    real business_health row: **cash tight, team solo, Capital 75, Risk 56, biggest_risk "Failing to close
    senior engineer hire"** + synthesis sent + weekly row closed. Resolves the original complaint #1 fully
    (Phase 1 acked; Phase 4 makes it real, stored, scored intelligence feeding the EoD).
  - ✅ **Bad-Day + Stage senders wired to open conversations** (`_add_open_conversation.py`):
    `badDayOverr1ghl` opens `bad_day_override` (24h), `stageTrans01ghl` opens `stage_transition` (24h);
    both swapped ACTIVE (Twilio `badDayOverr1`/`stageTrans01` deactivated). Their replies now match +
    get acked by the router's generic handler.
  - ✅ **War Room fold-in:** already satisfied — the unified router forwards `WAR ROOM`/active sessions to
    `/webhook/war-room` (built + verified Phase 1). 24h follow-up + Monday recurring-theme detection are
    future scheduled-workflow enhancements (tested `warRoom.js` logic exists for them).
  - **TODO (Phase 4 follow-ups):** wire **nudge_reply** (needs a GHL nudge sender — none exists yet, the
    active nudge engine `0EAKsIekNAOKYmQH` is still Twilio) and **day7_feedback** (onboarding needs day-7-
    only conditional, not the unconditional injector). Minor: EoD `fetchBusinessHealth` sorts by a
    non-existent `date` field → with multiple business_health rows the "latest" pick is arbitrary; sort by
    `week_start_date` instead.

## 🗣️ Two-Way Conversational Intelligence — ALL 4 PHASES LIVE (2026-06-23)
Full active conversational set on Hetzner: **morningCheckin1** (6AM ask) → **ghlInboundV1** (router:
weekly/morning/warroom/pending/fallback) → **briefBuilder1** (mood-adapted briefing) + **briefFallback1**
(7AM) · **eodPro00001ghl** (honest score) · **weeklySynth1** (business-health synthesis) ·
**badDayOverr1ghl** / **stageTrans01ghl** (open conversations). Reusable engine modules (all tested):
`pendingReplies.js` (20), `voice.js` (13), `morningMood.js` (15), `honestScore.js` (13).

✅ **INBOUND LOOP PROVEN END-TO-END (2026-06-23) — free, no US number.** Method: inject the customer's
reply via the **GHL "Add Inbound Message" API** (`POST /conversations/messages/inbound` with
`{type:'SMS', conversationId, message}`) — this appears as a real inbound in GHL and fires the
**"Customer Replied" automation exactly like a real SMS would**. Verified: injected "4 3 2" → GHL
automation → POST `/webhook/ghl-inbound` → router matched morning_checkin → stored biometrics
(sleep4/energy3/stress2) → Briefing Builder → mood-adapted briefing delivered to the +91 phone →
briefing_feedback opened → row closed. **Repeatable recipe:** (1) get conversationId:
`GET /conversations/search?locationId=..&contactId=v8lIYQuHTAcLFmbJ0HUt`; (2) open the relevant pending
row (or let a sender open it); (3) POST the inbound message; (4) watch the chain. Works for ANY inbound
type (weekly/score_feedback/war room) by injecting the matching reply.
  - ⚠️ **GHL payload fix:** GHL's webhook sends `message` as an OBJECT (e.g. `{body:"4 3 2"}`), not a
    string — `parseInbound` was reading `b.message` directly → `"[object Object]"`. **Hardened** to pull
    `b.message.body|text|message`, `b.customData.*`, with an `[object Object]` guard (redeployed, verified).
    The only thing NOT exercisable without a real US/2-way number is the literal carrier hop (+91 phone →
    GHL US number over SMS) — a carrier limitation, NOT a product gap; real US clients two-way cleanly.
  - **Final optional hardening (deferred):** set `RELENTLESS_WEBHOOK_SECRET` on the container AND add an
    `x-relentless-token` header in the GHL webhook action — do BOTH together (enforcing it before the GHL
    side sends the header would block the now-working automation). Optional: in GHL, map the webhook
    `message` field to "Message Body" (string) for cleanliness, though the parser handles the object now.

✅ **Multi-Source Morning Briefing — COMPLETE (2026-06-25).** Workflow `briefBuilder1` now live on Hetzner.
Full implementation: `build/harness/scoring/briefingAssembler.js` (21 tests); Python builder
`build/n8n/_build_briefing_builder.py`; simulation `_sim_brief_multisource.js` (25/25 passing).
**What it does:** each morning fetches News (`tbl_market_signals`), CRM contacts from GHL (new leads <24h,
gone quiet >14d), Calendar from Supabase (`meetings` table), assembles via `assembleBriefing()`, sends
SMS via GHL, persists to `tbl_briefings.sections_json` with per-source dashboard sections.
**Deployed:** imported to Hetzner (`167.233.94.171.nip.io`), published, pending n8n restart for webhook
registration at `/webhook/build-briefing`. Dashboard already renders per-source sections (T5/T6 done).

## 3. Where everything lives (file map)
All under `D:\DIGITAL DADA\GoeCoach-Plan\`:
- `GOECOACH-GOD-PLAN.md` — the full implementation plan (v3). Still the build bible for HOW.
- `reference/RELENTLESS-AI-SPEC.md` — **CANONICAL client spec (2026-06-03 master).** Supersedes the
  old one. Source PDF: `D:\DIGITAL DADA\Relentless AI Managed Service Spec.pdf`. Adds **War Room
  (Phase 9, Pro)** + rebrand + 8-week timeline.
- `reference/SPEC-EXTRACTED.md` — ⚠️ OLD/superseded spec (kept for history only — do not build from).
- `build/airtable/` — `SCHEMA.md` (all 15 tables), `create_airtable_schema.py` (already run),
  `BUILD-GUIDE.md` + `STEP-BY-STEP-BEGINNER.md`.
- `build/harness/scoring/` — **tested** JS modules used inside n8n Code nodes:
  `scoring.js` (51 tests), `scheduler.js` (17), `promptAssembler.js` (20). Run a test:
  `cd build/harness/scoring && node scoring.test.js`.
- `build/harness/HARNESS-GUIDE.md` — how the n8n harness fits together.
- `build/n8n/N8N-01..08-*.md` — the click-by-click guides the user is following, in order.
- `reviews/` — the architect/critic review trail (historical).

## 4. Confirmed tech facts / config
- **n8n:** self-hosted via **Docker**, container name **`n8n`**, at **http://localhost:5678**,
  data volume `n8n_data`. Start it: `docker start n8n`. **Current run command (recreated
  2026-06-02 to add IPv4-first DNS — see gotcha below):**
  `docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n -e NODE_OPTIONS=--dns-result-order=ipv4first -e TWILIO_AUTH_TOKEN=<twilio-auth-token> -e NODE_FUNCTION_ALLOW_BUILTIN=crypto -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false n8nio/n8n:latest`.
  ⚠️ **The last 3 env vars were added 2026-06-12 for the inbound hardening** (signature validation
  Code node needs `crypto` + `$env` access; `TWILIO_AUTH_TOKEN` is the HMAC key). Recreating the
  container WITHOUT them breaks the hardened inbound. Keep the token out of git.
  All data is in the `n8n_data` volume, so the container can be safely recreated without data loss.
- **Claude model = `claude-sonnet-4-6`.** ⚠️ Both spec versions list `claude-sonnet-4-20250514`,
  which is a DEAD id — do NOT use it; the live workflows correctly use `claude-sonnet-4-6`.
  Anthropic API via HTTP Request node, header `x-api-key` + `anthropic-version: 2023-06-01`.
- **Airtable bases (display names rebranded 2026-06-03):** `Relentless AI TEMPLATE` (10 client
  tables), `Relentless AI OPS` (5 ops tables incl. `tbl_clients_registry`), `Relentless AI -
  client_test` (the cloned test client). n8n holds a PAT credential still named `Airtable GoeCoach`
  (credential name unchanged — see naming note up top). n8n Airtable nodes bind by base **ID**
  (`app…`), so renaming base display names does NOT break workflows. Token lives only in n8n.
  **New table to add (Week 1 per new spec):** `tbl_war_room_sessions` (schema in §12 of new spec).
- **Twilio:** **trial** account, credential `Twilio GoeCoach` (name unchanged). ⚠️ India↔US SMS is
  blocked (see §7 gotcha) — **test over the WhatsApp Sandbox** (sandbox From `+14155238886`, n8n
  Twilio node "To Whatsapp" option ON). Keep SMS short + **plain ASCII**. Real US clients use plain
  SMS. War Room's `WAR ROOM` trigger will arrive through this same inbound webhook.

## 5. What's done vs. next
**Done (Tasks 1–11):** god plan; Airtable schema (live); scoring/scheduler/prompt modules (tests
green); n8n↔Airtable/Claude/Twilio; Morning Briefing (read→Claude→SMS) persisted + scheduled;
inbound webhook via WhatsApp Sandbox; biometric reply round-trip (parse→`manualRecovery`→reply→save
to `tbl_biometrics`). Rebrand to Relentless AI (docs + base names) done 2026-06-03.
✅ **2026-06-04 (built by Claude via JSON export/import, live-run verified):**
(a) **Briefing real-recovery hardened** — `buildBriefing` now picks the LATEST `tbl_biometrics` row
(`$input.all()` by date) instead of `$input.first()`; chain `Search records → Search records1 →
buildBriefing`; placeholder 72 gone (verified by equivalence — see EoD run below).
(b) **Phase 2 End-of-Day Score LIVE** — new workflow **"Relentless AI - End-of-Day Score - test"**
(id `ZgR4RSOdn86JsfjV`, active, manual + 7 PM `Asia/Kolkata` schedule). Chain: read profile +
latest biometrics → `computeScore` (inlined `scoring.js`, parity-tested 0 mismatches) → WhatsApp the
score → log `tbl_daily_scores`. Verified run: recovery 71 → Body 76, composite **78 (Strong)**,
WhatsApp sent, row written (`recrkVultSr78XX9i`). Pillars: Body = real recovery; **Focus 70 (engine
default), Execution 70 (PLACEHOLDER), Alignment 100** — replace Execution/Focus once GHL tasks + the
nudge engine exist.
**n8n build-via-import learnings (for future autonomous builds):** `n8n import:workflow` needs an
explicit `id` and imports workflows as **inactive** → after import run `n8n update:workflow
--id=<id> --active=true` then `docker restart n8n` to register webhooks/schedules. Airtable table
**IDs can't be read** (credential access is denied), so reference a table by name via an
**expression**: `table.value = "={{ 'tbl_daily_scores' }}"` (mode `id`) — bypasses n8n's static
id-format check; Airtable resolves the name at runtime. `n8n execute` CLI is unusable while the
container runs (task-broker port 5679 conflict) → trigger test runs via a temporary webhook, then
remove it. (Note: after a restart, webhook registration lags a few seconds — retry the first POST.)
✅ **2026-06-05 (built by Claude via JSON import, live-run verified) — Standard daily loop now
testable end-to-end:**
(c) **Phase 4 Nudge Engine LIVE** — workflow **"Relentless AI - Nudge Engine - test"**
(id `0EAKsIekNAOKYmQH`, active; schedule fires 8/10/12/14/16/18 `Asia/Kolkata` + manual). Chain:
profile + latest biometrics + recent nudges → `buildNudgePrompt` (guards: skip outside 8am–7pm, skip
if a nudge went out in the last 75 min; both unit-tested 10/10) → Claude (<100-char nudge) →
`extractNudge` → WhatsApp → log `tbl_nudges`. Verified run: nudge "Demo time. Open the file, hit
record, ship it today…" sent, row `reclvtApiXz4x3RdP`. (Skips the "in a meeting" check — needs
calendar, not connected.)
(d) **Feedback capture LIVE** — inbound webhook `scoreReply` is now a **router**: 3 numbers 1-5 →
biometric (unchanged, still saves `tbl_biometrics`); `YES/NO/SOMEWHAT` → feedback (writes
`tbl_feedback`, type=briefing if hour<14 else score, helpful YES=true/NO=false/SOMEWHAT=null);
`SKIP`/anything else → polite ack, no save. All 3 paths verified live (biometric `recBkpQPRv0zUclSj`,
feedback `recNzRSuPhf0P4m8h`). Plus **"Relentless AI - Feedback Question - test"** (id
`xRaDYtW7kySPKQjO`, active; 6:30 + 19:30 `Asia/Kolkata`) sends "Was your … useful today? YES/NO/SKIP".
**Inbound router precedence:** numbers→biometric is checked FIRST (protects the tested path); keyword
routing only runs when the message has <3 digits in 1-5.
✅ **2026-06-08 (built by Claude via JSON import; logic unit-tested + offline-simulated):**