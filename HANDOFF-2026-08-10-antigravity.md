# Relentless AI — Session Handoff, 2026-08-10 (for Antigravity)

Written because the user is switching tools (Claude Code limits exhausted) and needs a
complete, self-contained handoff. Supersedes `HANDOFF-2026-08-06.md` for current state —
that file is kept for its root-cause history, but treat **this** file as the source of truth
for "what's true right now." Everything below was verified against the live system on
2026-08-10 ~06:30 UTC, not recalled from memory.

---

## 0. What this project is

**Relentless AI** — an SMS-based executive coaching product. Clients sign up on a web
dashboard (Next.js + Supabase auth), get provisioned into GoHighLevel (GHL, the SMS/CRM
platform) and a Supabase client roster, then receive daily automated coaching messages via
n8n workflows: morning check-ins, nudges, end-of-day scores, weekly/monthly reports. Clients
reply by SMS; those replies feed back into their data (biometrics, scores, business health).

**Repo:** `d:\DIGITAL DADA\GoeCoach-Plan` (branch `main`, in sync with origin as of this
writing — verify with `git status -sb`)
**n8n server:** Hetzner VPS, `167.233.94.171`
**Supabase project:** `iqdkoufpiafbhmicbdsy`
**Web app:** Next.js in `relentless-web/`, deployed on Vercel

---

## 1. TL;DR — three things happened across two sessions

1. **2026-08-06:** A two-week total outage was fixed. Root cause: Airtable's monthly API
   billing quota was exhausted (not a rate limit — retries do nothing). The entire n8n data
   layer was migrated from Airtable to Supabase. Zero Airtable nodes remain anywhere.
2. **2026-08-08 to 08-10:** Two more bugs were found and fixed as a byproduct of verifying
   the migration actually worked in practice:
   - GHL's inbound webhook was never pointed at n8n, so **zero real client replies had ever
     reached the system** in 4 days — outbound worked, inbound was totally silent.
   - The SLA monitor hardcoded a 6 AM assumption and was hourly-alerting on `client_test`.
3. **Just diagnosed, NOT yet fixed (this handoff's main job):** three more root causes for
   "nudges/weekly/monthly not working" and "Executive Score always 0." See §4. None require
   guesswork — all four are pinned to specific code or data, ready for the next agent to fix.

**Current health:** n8n is stable — hundreds of executions, ~0 errors from current code
(remaining errors are stale, pre-migration). Outbound SMS works well. **Inbound/scoring data
capture has real, specific, fixable gaps**, detailed in §4.

---

## 2. Prerequisites — read before touching anything

### 2.1 SSH / server

```bash
ssh -i ~/.ssh/id_dadaai root@167.233.94.171
```

- Live n8n container is **`n8n-n8n-1`**. There is also a `dadaai-n8n` container — a
  **different, older, unrelated instance**. Do not confuse them.
- Compose project lives at `/root/n8n`.
- If `~/.ssh/id_dadaai` isn't present on the new machine, it needs to be provisioned by the
  user — it is not something to regenerate or guess at.

### 2.2 Supabase — the single most important gotcha

The Relentless project is **`iqdkoufpiafbhmicbdsy`**.

**Supabase MCP tools (if configured in the new environment) may not be able to reach it.**
In the Claude Code session, that connection authenticated to a *different* account whose
only project was `htjdbmusgratlxiaelbc` (an unrelated app). Calling `list_tables` on the
Relentless ref returned *"You do not have permission to perform this action."* **Test this
first** rather than assuming it works or is broken — Antigravity's MCP config may differ.

If it doesn't work:
- **DDL** (CREATE TABLE, ALTER, etc.) must be run by the **user** in the SQL Editor:
  https://supabase.com/dashboard/project/iqdkoufpiafbhmicbdsy/sql/new
- **Data** (SELECT/INSERT/UPDATE/DELETE) is reachable from inside the n8n container, which
  has `SUPABASE_SERVICE_KEY` in its environment. Use `node` + `fetch` (pattern in 2.3).

### 2.3 Container tooling limits (these will bite you)

| Want | Problem | Use instead |
|---|---|---|
| `curl` on host | not installed | run from inside container |
| `sqlite3` in container | not installed | it IS on the host |
| DELETE/PATCH via `wget` | BusyBox wget has no `--method` | `docker exec n8n-n8n-1 node -e '...fetch...'` |
| `date -d '+2 hours'` in container | BusyBox date rejects it | compute on the host, pass via `-e` |
| `n8n execute --id=X` | task-broker port conflict while n8n is running | wait for the real cron |
| n8n REST API | no `N8N_API_KEY` configured | CLI or wait for cron |
| Python `json.load` on nested sqlite3 -json output | the row wrapper `[{"nodes": "..."}]` is a **string**, not parsed JSON | `json.loads(raw[0]['nodes'])` — double-parse |

Working pattern for any Supabase data call from the server side:

```bash
ssh -i ~/.ssh/id_dadaai root@167.233.94.171 'docker exec n8n-n8n-1 node -e "
const k=process.env.SUPABASE_SERVICE_KEY;
const U=\"https://iqdkoufpiafbhmicbdsy.supabase.co/rest/v1\";
const H={apikey:k,Authorization:\"Bearer \"+k};
(async()=>{ const r=await fetch(U+\"/v_clients?select=client_id\",{headers:H});
  console.log(await r.text()); })();
"'
```

For writes, add `Content-Type` and `Prefer: return=representation` headers and pass
`method:"PATCH"` / `"POST"` / `"DELETE"` to `fetch`.

### 2.4 ⚠️ WAL MODE — this nearly caused a destructive mistake once already

The n8n SQLite DB runs in **WAL mode**. `docker cp` of `database.sqlite` alone returns a
**stale** file. This has already caused one successful import to look like a failure —
trusting that stale read and re-deploying would have overwritten working state.

**Always copy all three files together, every time:**

```bash
rm -f /root/x.sqlite*
for f in database.sqlite database.sqlite-wal database.sqlite-shm; do
  docker cp n8n-n8n-1:/home/node/.n8n/$f /root/x.${f#database.}
done
sqlite3 -header -column /root/x.sqlite "SELECT ..."
```

### 2.5 Shell / path environment

Local shell in the prior session was **Git Bash on Windows**. Antigravity's shell may
differ — verify before assuming these apply, but if it's also Git Bash:

- Heredocs work: `git commit -F - <<'EOF'`. PowerShell here-strings (`@'...'@`) do **not** —
  they produce `pathspec did not match` errors.
- `tar`/`scp` need **Unix-style paths**: `/c/Users/...`, not `C:/Users/...`. `tar` reads
  `C:` as a remote host and fails with *"Cannot connect to C: resolve failed"*.
- **`node` on Windows needs Windows-style paths** (`C:/Users/...`), the *opposite* of tar/scp.
  Mixing these up produces `ENOENT` errors that look like a missing file when the file exists.
- In heredoc'd Python, shell variables like `$SP` do **not** expand inside the heredoc body.
  Pass them as script arguments (`python3 script.py "$SP/file.json"`) instead.

### 2.6 n8n deploy sequence (exact, tested, do not skip steps)

1. Export the live workflow (nodes + connections + settings) from the WAL-inclusive DB copy.
2. Patch/convert as needed, write to a new file.
3. `scp` to the host, then `docker compose cp <file> n8n:/tmp/<file>`.
4. `docker compose exec -T n8n n8n import:workflow --input=/tmp/<file>` — **this deactivates
   the workflow on import**, every time, with no exception seen yet.
5. `docker compose exec -T n8n n8n update:workflow --id=<id> --active=true` — reports
   "Please use publish:workflow" and "changes will not take effect if n8n is running" but
   this is the working command; ignore the deprecation warning.
6. `docker compose restart n8n` — **required** for step 5's change to actually load.
7. Verify against the WAL-inclusive DB copy that the live `nodes` column contains what you
   expect (e.g. `grep`-check for a marker string in the JS, or check `active=1`).
8. Check `docker logs n8n-n8n-1 --tail 60` for `Activated workflow "<name>"` — confirms it's
   live. `"Deregistered all crons"` earlier in the log is shutdown teardown, not a failure.

**These are live cron senders reaching real paying clients.** A bad deploy sends real SMS,
not just errors. Always snapshot the pre-deploy state first:

```bash
sqlite3 -json /root/x.sqlite "SELECT id,name,nodes,connections,settings,active \
  FROM workflow_entity WHERE id='<workflow_id>';" > /root/<id>_ROLLBACK_$(date +%Y%m%d_%H%M%S).json
```

---

## 3. What was fixed across the last two sessions (context, already done, don't redo)

### 3.1 The Airtable outage (2026-08-06)

Airtable returned *"The service is receiving too many requests from you"* (HTTP 429), which
reads like a rate limit. The actual error code was **`PUBLIC_API_BILLING_LIMIT_EXCEEDED`** —
a **monthly billing quota**, immune to retries/backoff. All 43 remaining Airtable nodes
across 14 workflows were converted to Supabase. Full detail, including the schema design
rationale (`client_profile` vs `profiles` split, natural-key re-keying, views absorbing
filters the Supabase node can't express) is in `HANDOFF-2026-08-06.md` §3–4. Don't re-read
unless you need that historical detail — the summary above is what's load-bearing now.

Migrations applied, in order: `001_schema_phase1.sql`, `002_schema_phase2_biometrics_scores.sql`,
`003_schema_inbound_router.sql`, `004_schema_remaining_workflows.sql`. All four are applied
to Supabase already. Do not re-run unless specifically debugging a missing table — they are
idempotent (`IF NOT EXISTS` guarded) but there is no need.

### 3.2 GHL inbound webhook was never configured (found + fixed 2026-08-08–10)

**Symptom:** outbound SMS worked (448+ successful sends), but zero real client replies had
ever reached n8n — `ghlInboundV1` had fired only twice in 4 days, both from manual testing.

**Root cause:** GHL had no webhook/workflow action pointing at n8n's inbound endpoint. This
was a GHL **dashboard configuration gap**, not a code bug — the endpoint itself was
confirmed reachable (`POST https://167.233.94.171.nip.io/webhook/ghl-inbound` → `200
{"ok":true}`; an unknown path correctly 404s, proving genuine routing not a catch-all).

**Fix applied by the user:** created a GHL Workflow — trigger "Customer Replied" → action
"Webhook" → POST to the URL above. **First attempt only sent `contactId`** in Custom Data;
the n8n parser (`parseInbound` node in `ghlInboundV1`) requires `contactId` AND `body`/`text`
(the message content) AND ideally `messageId`, or it silently `return []`s and does nothing.
User added `body` and `messageId` custom-data fields using GHL's merge-field picker.

**Verified working** with real traffic from Dwayne (`client_da8719ab`, contactId
`FGRKMuONxezAC6d940BJ`): a free-text reply *("Let's do the War Room tomorrow")* correctly
routed to a generated conversational reply; a numeric reply *("4 4 1")* was correctly
**not** matched to biometrics because it arrived 26 minutes after his 2-hour reply window
had expired — that's the system working as designed (`v_open_pending_replies` correctly
excludes expired rows), not a bug. See §4.1 for why this reply-window design is now the
dominant blocker on data capture.

### 3.3 SLA monitor false alarms (found + fixed 2026-08-10)

**Symptom:** hourly SMS alerts *"morning send missing... client_test"*.

**Root cause, two parts:**
1. `client_test.delivery_hour` was `23` — a leftover from migration verification (set to
   prove exactly one message reached one client), never reset.
2. `slaMonitor1`'s `evaluate` node **hardcoded** the due-check window as local hour 8–9,
   assuming every client is briefed at 06:00. Any client with a non-default `delivery_hour`
   would trigger the same false alarm — not specific to `client_test`.

**Fixed:** `client_test.delivery_hour` reset to `NULL` (Supabase UPDATE, no code change).
`evaluate` node patched to read `delivery_hour` per-client and compute the window as
`[dh+2, dh+3]`, falling back to 6 if unset. Deployed via the standard sequence (§2.6),
verified live in the running DB. Source: `build/n8n/_fix_sla_delivery_hour.py`.
Rollback: `/root/slaMonitor1_ROLLBACK_20260810_114635.json` on Hetzner.

### 3.4 Web app icons/manifest (2026-08-06)

Brand logo wasn't showing on home-screen shortcuts. Two stacked bugs: the auth proxy 307'd
`/manifest.webmanifest` to `/login` (browsers fetch manifests anonymously, so auth always
saw a signed-out request); and separately, `src/app/icon.tsx`/`apple-icon.tsx` — Next.js
file-convention icon generators — were silently overriding the real logo files in `public/`,
because a file convention outranks a same-named static file. Both fixed, deployed, verified
live on Vercel. Full detail in `HANDOFF-2026-08-06.md` §"TASK 3."

---

## 4. What's broken RIGHT NOW — diagnosed 2026-08-10, NOT yet fixed

This is the actual work for the next agent. Four distinct, evidence-backed root causes.
**None of these are "the migration is broken"** — the system is structurally sound;
these are specific gaps.

### 4.1 🔴 Root cause of "Executive Score always 0" — the 2-hour reply window is too tight

**This is the dominant issue and explains most of the rest.**

`eodPro00001ghl`'s `computeScore` node computes an "honest" score: each of 4 pillars (Body,
Focus, Execution, Alignment) only counts if there's real evidence, and the composite needs
**at least 2 of 4 pillars present** or it returns `enoughData: false` (a "quiet day" message
instead of a score — this is intentional, documented behavior, not a bug in itself).

- **Body** needs a `biometrics` row for that day.
- **Focus** needs nudges where `responded=true`.
- **Execution** needs GHL Tasks matching the client's stated top priorities.
- **Alignment** is **hardcoded `null` always** — the code comment says *"no
  interruptions/priority-completion feed yet"*. This pillar was never built. Not a bug to
  fix quickly; it's a missing feature (see §4.4).

Live evidence (checked 2026-08-10):
```
biometrics (all time):            0 rows
pending_replies with status='matched': 0 rows (ever, all clients)
daily_scores with real data:      0 rows — every row has biometric_missing=true, 
                                   composite_score=null
```

**Why biometrics is still 0 even with inbound now working:** the morning check-in's pending
reply window is **2 hours** (`opened_at` to `expires_at`). Dwayne's `"4 4 1"` reply (a real,
valid 3-number answer) arrived 26 minutes **after** his window closed. `v_open_pending_replies`
correctly excludes expired rows by design (this was the fix for a real risk in the original
migration — see `HANDOFF-2026-08-06.md` §5.5) — so the reply fell through to a generic
Claude-generated response instead of being captured as biometrics.

**This is a real, fixable gap, not "wait and see":**
- The 2-hour window may simply be too tight for how people actually reply to morning texts.
- Consider widening it (e.g. to 6–8 hours, or same-day), OR
- Add a distinct "late reply" path that still captures a same-day biometric even after the
  formal window closes, OR
- Confirm with the user this is genuinely intended behavior and the real fix is coaching
  clients to reply fast.

**File to look at:** the code that sets `expires_at` in `openConversation` /
`morningCheckin1` (`$now.plus({ hours: 2 })`). This is a **product decision as much as a
code fix** — flag it to the user before changing the window, since it changes what counts as
"on time."

### 4.2 🟡 "Nudges not working" — likely means the Focus pillar, not the nudges themselves

**Nudges are actually sending correctly.** 126 real nudge SMS in the last 3 days across all
6 SMS-capable real clients, throttled properly (roughly every 2 hours, no duplicates). This
part of the system works.

**What's actually broken:** the `responded` column on every nudge row is `false`/unset —
**0 of 161 sampled nudges have ever been marked `responded=true`.** Since Focus score =
`nudge_response_ratio`, Focus can never have data either. There is currently **no code path
that flips `responded` to `true`** when a client replies to a nudge — the inbound router
(`ghlInboundV1`) only recognizes `morning_checkin`, `weekly_checkin`, and War Room replies as
"expected types"; a reply to a nudge isn't one of `pendingReplies.js`'s recognized types
(`SEQUENCE_TYPES`, `FREETEXT_TYPES`, `SINGLE_SHOT_ACCEPTS`), so even if a client *does* reply
to a nudge, nothing marks it responded.

**Confirm with the user which is true before building anything:**
1. Is a nudge supposed to open a `pending_reply` of some `nudge_reply`-shaped expected_type
   when it's sent (so a reply can be matched)? Currently `nudgeEngineGhl1` does **not** open
   a pending reply — check its nodes to confirm.
2. Or is "responded" meant to be inferred some other way (e.g. any inbound SMS within N hours
   of a nudge, regardless of matching)?

This needs a product decision, then straightforward implementation once decided.

### 4.3 🟡 Monthly Report — literally cannot run, both versions are inactive

```
monthly00001      (old, non-GHL)   active = 0
monthly00001ghl   (GHL version)    active = 0
```

Neither version of Monthly Report is active in n8n. This isn't a scoring/data problem —
it's simply **turned off**. Check whether this was intentional (maybe deprioritized, maybe
forgotten) before reactivating. If it should run, activate `monthly00001ghl` specifically
(it's the GHL-integrated, Supabase-converted version — do NOT activate `monthly00001`, the
older non-GHL one, unless you've confirmed it's also been converted off Airtable).

### 4.4 🟡 "Weekly Business Health not working" — the writer node is missing, not just timing

`weekly000001ghl` runs successfully (100/100 recent executions) and correctly **sends** the
weekly check-in question via SMS, opening a `pending_replies` row of type presumably
`weekly_checkin`. But:

**`business_health` table has 0 rows, always, even though the workflow "works."**

Traced the full node graph: `weekly000001ghl` has **no node that writes to
`business_health`** — it only asks the question. The write is supposed to happen when the
client's reply comes back through `ghlInboundV1`'s `closeWeekly` node — but `closeWeekly`
only updates `pending_replies.status = 'matched'`. **It never writes to `business_health`
at all.** This is a genuine gap in the router conversion from the original migration, not
a timing/window issue like §4.1 — even a reply that arrives instantly, inside the window,
would still not produce a `business_health` row today.

**Fix needed:** `ghlInboundV1`'s dispatch/close logic needs a new branch (or `closeWeekly`
needs a sibling write) that, when a `weekly_checkin` reply matches, parses the client's
answer and writes a `business_health` row (columns: `client_id`, `week_start_date`,
`cash_position`, `team_health`, `biggest_risk`, `risk_deliberate`, `capital_score`,
`risk_score`, `checkin_completed`, `claude_analysis` — see `004_schema_remaining_workflows.sql`
for the full column list). What the weekly check-in SMS actually *asks* (single number? free
text? multiple questions?) needs to be read from `weekly000001ghl`'s prompt-building code
first, since the parser must match the actual question shape.

---

## 5. Priority order for the next agent

```
P0  Confirm P0 from the previous handoff cycle is truly done
     ghlInboundV1 fires on real traffic - CONFIRMED YES (§3.2). No action needed here.

P1  Decide + fix the reply-window gap (§4.1)              <- blocks Body pillar + most scoring
     This is a product decision (window length) as much as code. Ask the user first.

P2  Decide + build the nudge-response tracking (§4.2)      <- blocks Focus pillar
     Needs a product decision on whether nudges should open a pending_reply.

P3  Build the business_health writer in ghlInboundV1 (§4.4) <- blocks Weekly Business Health
     Needs the actual weekly-checkin question format read first.

P4  Confirm with user whether Monthly Report should be active (§4.3)
     If yes: activate monthly00001ghl specifically, verify it's Supabase-converted first.

P5  Alignment pillar (§4.1, "no interruptions/priority-completion feed yet")
     This is a genuinely new feature, not a bug fix. Lowest priority; flag to user, don't
     build without a design discussion.

P6  Roster cleanup (carried over, still open, still needs user decisions):
     - 4 client rows with no ghl_contact_id, can't receive SMS: client_73bed63e,
       client_24397b6b, client_720b9768, client_0bf09430. Ask user: deactivate, provision,
       or delete? Do NOT decide unilaterally.
     - Oyaide (client_d2232ae2) timezone is placeholder 'UTC'. +234 phone suggests
       Africa/Lagos but confirm with user before changing - a phone prefix isn't proof of
       residence.
     - 50 stale pending_replies sit status='open', all past expiry. Harmless (the view
       excludes them) but could be marked 'expired' for hygiene.
     - Credentials were pasted in plaintext during earlier debugging sessions (Twilio token,
       NewsData key, Supabase service key, n8n API key) - flag for rotation, not urgent but
       real.

P7  Exercise warRoom0001 with a real Pro client
     Every client currently shows plan='standard', including client_test. War Room will
     refuse everyone as non-Pro until at least one client is set to plan='pro'. Ask the user
     which client should be Pro (probably client_test for testing), or set it yourself in
     Supabase (client_profile does not have `plan` - it's on `profiles`, per the identity
     split in §3.1/HANDOFF-2026-08-06 §4.2).
```

---

## 6. Full prompt to hand to Antigravity

```
CONTEXT
=======
Continuing work on Relentless AI, an SMS-based executive coaching product.
Repo: d:\DIGITAL DADA\GoeCoach-Plan (branch: main)

Two prior sessions fixed a two-week Airtable outage (migrated the entire n8n
data layer to Supabase) and two follow-on bugs (GHL inbound webhook was never
configured; an SLA monitor was hardcoded to assume a 6 AM send time). All of
that is DONE and verified working.

MANDATORY FIRST STEP
====================
Read HANDOFF-2026-08-10-antigravity.md in the repo root IN FULL before doing
anything. It is self-contained and supersedes the older HANDOFF-2026-08-06.md
for current state (that older file is kept only for migration history/detail).

Section 2 covers prerequisites and traps that will cost hours if skipped:
credential access patterns, a WAL-mode gotcha that already nearly caused a
destructive redeploy, Windows-vs-Unix path handling differences between tools,
and the exact tested n8n deploy sequence (steps matter - import DEACTIVATES on
import, every time; a restart is required for reactivation to take effect).

CURRENT STATE (verified 2026-08-10 ~06:30 UTC - re-verify, don't trust blindly)
================================================================================
- n8n: stable, ~0 errors from current code (any errors you see are pre-migration,
  from before 2026-08-06 13:57 UTC - stale, not live problems)
- Outbound SMS: works well - hundreds of successful sends, correct per-client
  local-time delivery, correct throttling
- Inbound SMS: now reaching n8n correctly (was completely broken until 08-08,
  fixed by configuring a GHL workflow webhook)
- Scoring/data-capture: has REAL, SPECIFIC, DIAGNOSED gaps - this is your actual
  work, detailed in HANDOFF §4

YOUR ACTUAL WORK - 4 diagnosed root causes, priority order in HANDOFF §5
==========================================================================
1. (P1, blocks the most) Morning check-in reply window is only 2 hours, and
   replies outside it are correctly-but-unhelpfully discarded rather than
   captured. This is why "Executive Score is always 0" - Body pillar needs a
   biometrics row, and almost nothing lands inside the window. This is a
   PRODUCT decision (how long should the window be?) as much as a code change -
   ask the user before changing it.

2. (P2) Nudges ARE sending correctly (126 in 3 days, verified) but the
   `responded` column is never set true on any of them, so the Focus score
   pillar can never have data. Need to determine whether nudges should open a
   pending_reply row so a client's reply can be matched and flip that flag -
   this needs a product decision, not just code.

3. (P3) Weekly Business Health sends its question correctly but there is NO
   code path anywhere that writes a business_health row when the client
   replies - ghlInboundV1's closeWeekly node only marks the pending_reply
   matched, nothing more. This needs a new write branch built, but first you
   need to read what question weekly000001ghl actually asks so the parser
   matches the real answer shape.

4. (P4) Both Monthly Report workflows (monthly00001 and monthly00001ghl) are
   simply INACTIVE in n8n - ask the user whether that's intentional before
   reactivating anything, and if reactivating, use monthly00001ghl (the
   Supabase-converted one), not the old Airtable-era monthly00001.

Also open, lower priority, listed in full in HANDOFF §5 P5-P7: an Alignment
scoring pillar that was never built (genuinely new feature, needs design
discussion, don't just build it), 4 client roster rows that can't receive SMS
and need a user decision on what to do with them, one client's placeholder
timezone, some plaintext-pasted credentials that should be rotated, and
War Room being untestable until at least one client has plan='pro'.

GROUND RULES
============
- NEVER put the Supabase service key on a command line. Read it from the
  container env (process.env.SUPABASE_SERVICE_KEY inside n8n-n8n-1).
- These are LIVE cron senders reaching REAL PAYING CLIENTS. A bad deploy sends
  real SMS, it does not merely error. Snapshot before deploying, verify against
  client_test first.
- Several of the items above are explicitly PRODUCT decisions, not just code
  fixes (reply window length, whether nudges should be repliable, whether
  Monthly Report should run). Surface these to the user and get a decision
  before implementing - don't guess at product intent.
- Verify claims against the live system, always. Every fact in the handoff was
  checked against live data as of 2026-08-10; if it's now stale, trust the live
  system and tell the user the handoff needs an update.
```

---

## 7. Ground rules (repeated here for emphasis — also in §2.6)

- **Never put the Supabase service key on a command line.** Read it from the container's env
  (`process.env.SUPABASE_SERVICE_KEY`) or a scratchpad file that is deleted after use. Redact
  values when grepping `.env` files: `sed -E 's/=.*/=<redacted>/'`.
- **These are live cron senders reaching real paying clients.** A bad deploy sends real SMS
  rather than merely erroring. Verify against `client_test` before anything touches the other
  real clients, and snapshot before deploying.
- **Read WAL-inclusive** (§2.4) before concluding anything about n8n DB state.
- **Several open items are product decisions, not just code fixes** (§4.1 reply window
  length, §4.2 whether nudges should be repliable, §4.3 whether Monthly Report should run,
  §4.5/P5 the Alignment pillar, P6 what to do with 4 non-functional client rows). Surface
  these to the user and get a decision before implementing — don't guess at product intent
  on the user's behalf, especially anything that changes what a client experiences.
