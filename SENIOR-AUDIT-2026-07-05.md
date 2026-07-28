# Relentless AI — Senior Production Audit (2026-07-05)

**Auditor stance:** principal-level review. Unlike the June 20 audit (document-based), this one is
grounded in **three days of live production forensics** — real execution histories, real client
data, real failures traced to root cause on the Hetzner box. Nothing below is speculative; every
claim cites what was actually observed.

**The question asked:** is this ready for international clients, multi-user, everything working
end-to-end, personalized, up to date?

---

## THE SCORE: 4.5 / 10 (international production) · 6 / 10 (US-only beta)

| Dimension | Score | One-line justification |
|---|---|---|
| Core daily loop (US client) | 7/10 | 7 of 8 senders now verified firing multi-client on schedule; briefings daily-unique + energy-aware |
| International delivery | **2/10** | 6 of 14 live clients (+91/+234/+92) receive **nothing** — GHL cannot SMS them; WhatsApp channel built offline but not approved/wired |
| Multi-user correctness | 6/10 | Single-client fan-out bug fixed and verified live; but all existing clients still have wrong timezones in Airtable until backfill + web deploy |
| Personalization loop | **4/10** | Outbound is genuinely personalized (scores, energy, anti-repetition). But the **inbound half is dead since 06-30** — no check-in replies flow in, so sleep/energy/stress data isn't refreshing |
| Reliability / ops | **3/10** | Deploys are live-DB surgery (CLI broken); caused a real outage this week; no CI, no tests on the web app, no staging, single VPS, SQLite |
| Security / compliance | 5/10 | API routes properly session-guarded; but dev-bypass code in prod routes, DEBUG logging of user IDs, privacy policy still DRAFT, A2P/international SMS compliance unaddressed |
| Documentation accuracy | 4/10 | Extensive docs, but HANDOFF/spec drift badly from live reality (dead model IDs, superseded architecture claims) |

**Bottom line:** after this week's fixes, a **US client with a correct GHL contact gets a real,
personalized daily coaching loop** — that's genuinely working and verified. But the promise
"international, multi-user, end-to-end, everything executes" is **not yet true**: non-US clients
get zero messages, replies from anyone go into a void, one sender is permanently erroring, and the
deployment pipeline is dangerous enough that shipping fixes has itself caused outages.

---

## PART 1 — What is genuinely solid (verified live, not from docs)

1. **The daily engine now serves every client, not just the first one.** The catastrophic
   single-client bug (every sender processed only Airtable row #0) was found via live execution
   forensics and fixed across all senders; verified at 05:30/06:00/06:30 on 2026-07-05 with real
   multi-client output. This was the #1 "why is nobody getting SMS" cause.
2. **Workflow activation restored.** 5 senders had been silently dead since 07-02 (n8n's
   `activeVersionId` NULL → silent skip on startup; traced into n8n 2.26's compiled source).
   Fixed; all now log "Activated" and fire on schedule. n8n stable 16+ hours, 0 restarts.
3. **Briefing intelligence is real.** Live briefBuilder1 includes yesterday's score, latest
   check-in, last-3-briefings anti-repetition, weekday/date, energy-aware task triage.
   Verified 11/11 offline (3 simulated days → all unique, correctly calibrated).
4. **NewsData.io market signals work.** Live execution proof: real API call succeeded, real
   articles fetched, multi-client fan-out correct. (One edge-case bug found live — see gaps.)
5. **The scoring harness** (`build/harness/scoring/*`): pure, unit-tested modules (100+ tests) —
   still the engineering gold standard in this repo.
6. **Web API auth posture is fundamentally right:** every data route checks the Supabase session
   server-side; client context derives from the signed-in user's profile row, not env vars;
   tasks-sync adds same-origin checks. Worldwide timezone picker (418 IANA zones) built and
   compiles clean.
7. **Monitoring exists and tells the truth now:** SLA monitor rebuilt to per-client, timezone-aware
   "due but missing" checks (the daily false "15h ago" alert is dead), and names the specific
   missing client.

---

## PART 2 — Critical gaps (P0: a paying international client TODAY hits these)

### P0-1 · Non-US clients receive nothing
6 of 14 live clients have +91/+234/+92 numbers. GHL (US A2P) cannot deliver to them. The WhatsApp
channel kit is **built and tested offline** (channel resolver 11/11, send-node templates, 6 Meta
message templates drafted) but is **not live**: needs (a) Meta Business + Twilio WhatsApp Business
sender approval (user action, 1–3 days), (b) template approval, (c) wiring into 7 senders.
**Until then, "international" is marketing, not reality.**

### P0-2 · The inbound half of the loop is dead (since 06-30)
`ghlInboundV1` receives webhook POSTs (returns ok) but no real client reply has been processed
since 06-30. Consequences compound: no sleep/energy/stress check-ins → briefing mood-adaptation
runs on stale data; DONE/SKIP on reminders never registers; scores never confirm. The router-side
matching bugs were fixed and verified offline (25/25), but the **transport** — GHL's "Customer
Replied" automation → webhook — is unverified in GHL itself, and webhook executions mysteriously
don't record in n8n. **Personalization without inbound data decays to templated output within days.**

### P0-3 · stageTrans01ghl (weekly plan sender) errors on every single run
Still unresolved after four fix attempts (loop rebuild, reference fix, explicit mode, activeVersion).
The error ("A 'json' property isn't an object", thrown by n8n's *each-item* validator despite the
node being stored as all-items mode) contradicts n8n's own stored config — evidence n8n executes
this workflow from a cached/divergent representation. **Recommended: rebuild this workflow from
scratch as a new workflow ID via the n8n UI/API rather than a fifth DB patch.** Weekly plans
currently go out to nobody.

### P0-4 · Existing clients' timezones are all wrong
Every live client is stored as America/New_York (or UTC) regardless of reality, because the old
signup discarded non-US timezones. The worldwide picker is built but **not deployed to Vercel**,
and the 14 existing rows are **not backfilled**. Until both happen, "according to their timezone"
only works for the accidental America/New_York subset.

### P0-5 · Staged-but-undeployed fixes are rotting
Built, verified, sitting on disk: market signals no-news gate (7/7), worldwide timezone picker,
dashboard reorder (todos/meetings on top), Gmail connector, Yesterday's Score label. Two deploy
actions pending: one n8n deploy (market000001) and one `vercel deploy --prod`. Every day undeployed
is a day the live system diverges from the verified code.

---

## PART 3 — Important gaps (P1: will bite within weeks)

1. **Delivery-status blindness.** A GHL "message sent" is not "message delivered." No
   failed/undelivered tracking exists, so silent delivery failures (bad numbers, carrier blocks)
   are invisible. The SLA monitor checks *sends*, not *deliveries*.
2. **8 of 14 clients lack ghl_contact_id.** `contactRepair1` is deployed to fix this automatically,
   but its end-to-end effect (contacts actually created, rows patched) is **not yet verified**.
3. **Webhook executions don't record.** briefBuilder1/ghlInboundV1 return HTTP 200 but create no
   execution rows — pre-existing, still undiagnosed. Makes debugging inbound (P0-2) nearly blind.
4. **Provisioning at scale is unproven.** Everything runs on the single `client_test` Airtable
   base. Per-client base provisioning (the actual multi-tenant model in the spec) has never been
   exercised end-to-end with a real second base.
5. **onboarding burst semantics.** onboard00001ghl now runs, but whether the 7-message day-1 burst
   behaves correctly for a brand-new signup hasn't been observed live since the rebuild.
6. **Compliance debt:** privacy policy still DRAFT (was called the launch blocker in June);
   international messaging consent/opt-out (STOP handling) unverified in the GHL flow; WhatsApp
   adds its own template/opt-in rules.

---

## PART 4 — Engineering-practice gaps (the "decades of experience" verdict)

These are why the ops score is 3/10, and they cost you real downtime this week:

1. **Deployment is unsafe by construction.** n8n's CLI import silently no-ops on this version, so
   deploys are direct SQLite writes against the production volume. This week that caused: a
   file-ownership crash-loop, a corrupted-WAL incident, and an hours-long partial outage — all
   self-inflicted by the deploy method, not the code being deployed. There is also **no staging
   instance**; every experiment is production surgery. *Minimum fix: a second n8n container on the
   same box as staging + a scripted, tested deploy path (the volume-write + chown 1000:1000 +
   wal-clean procedure that finally worked, wrapped in one idempotent script). Better: upgrade/fix
   n8n so its API or CLI import works, and stop touching SQLite.*
2. **No CI, no web tests.** `npx tsc` is the only gate, run by hand. One Playwright spec exists and
   doesn't compile. No test runs on push; no protection against regressions in 15 API routes and a
   2,000-line dashboard page component.
3. **The dashboard is a monolith.** `dashboard/page.tsx` is ~1,800+ lines holding scores, tasks,
   meetings, briefings, tours, recurrence editing, market signals. Every change risks everything;
   this is where the next UI regression comes from. Split into feature components.
4. **Observability is DB-spelunking.** All production debugging this week required SSH + sqlite
   forensics (with a WAL-staleness trap that produced repeated false outage alarms). No dashboards,
   no log aggregation, no alerting beyond the single SLA SMS.
5. **Doc drift is dangerous.** HANDOFF.md and the spec contain superseded facts (dead Claude model
   ID, Twilio-era architecture, "workflows inactive" claims). A new engineer following the docs
   would rebuild the wrong system. The best current source of truth is the memory files + this
   audit, which is itself a smell — docs should be trimmed to a small, maintained core.
6. **Residual dev-bypass code in production routes** (`provision`'s isDev Bearer-userId path) and
   verbose `[DEBUG]` logging of user IDs/profiles. Low exploitability today, bad hygiene always.

---

## PART 5 — Next steps (ordered; each unblocks the next)

### This week — close the loop for US clients (gets you to a honest 7/10 US beta)
1. **Deploy the two staged fixes** (market000001 no-news gate via the proven n8n method;
   `vercel deploy --prod` for timezone picker + dashboard reorder + Gmail). *30 min, mostly done.*
2. **Backfill the 14 clients' real timezones** in Airtable (needs the truth from you/clients; the
   backfill script exists).
3. **Fix inbound end-to-end** (P0-2): verify the GHL "Customer Replied" automation is published and
   pointed at the webhook; send a real reply from the US test number; trace it to a closed pending
   row. This single item revives the entire personalization flywheel.
4. **Rebuild stageTrans01ghl as a fresh workflow** (new ID, built in the n8n UI from the verified
   JSON) instead of patching the haunted one. Retire the old ID.
5. **Verify contactRepair1 actually repaired** the 8 missing GHL contacts; alert on the remainder.

### Next 2 weeks — make "international" true (7/10 → 8/10)
6. **You:** Meta Business + Twilio WhatsApp Business sender registration (paperwork, 1–3 day
   approval) + submit the 6 drafted templates.
7. **Me:** wire the channel router (built, tested) into all 7 senders; backfill `channel` per
   client; live-test with one +91 number end-to-end.
8. **Delivery-status tracking:** GHL/Twilio status callbacks → tbl_delivery_status → SLA monitor
   digest includes failed/undelivered per client.

### Weeks 3–4 — stop being one bad deploy from an outage
9. **Staging n8n** container + scripted deploy (no more hand-run SQLite surgery on prod).
10. **CI on the web app:** tsc + lint + (fixed) Playwright smoke on every push; block deploy on red.
11. **Split dashboard/page.tsx** into components; delete dev-bypass/DEBUG code from API routes.
12. **Docs consolidation:** collapse HANDOFF/spec/plans into one ≤200-line CURRENT-STATE.md that is
    updated as part of every deploy (definition of done), archive the rest.
13. **Compliance:** finalize privacy policy (attorney), verify STOP/opt-out path, document
    per-country sending rules for the WhatsApp channel.

---

*Report grounded in: live Hetzner execution history 07-02→07-05, n8n 2.26.7 source inspection,
14-client Airtable data, all 15 web API routes, prior audits (reviews/, SeniorDevReview.md),
HANDOFF.md, GOECOACH-GOD-PLAN.md, RELENTLESS-AI-SPEC.md, and the fix-verification suites built
this week (multiclient 6/6, briefing 11/11, SLA 4/4, inbound 25/25, market news 12/12 + 7/7,
channel resolver 11/11).*
