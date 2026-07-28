# Fan-out spec — make demo-critical senders multi-user (2026-06-26)

**Goal:** EoD score, Nudge engine, Meeting reminders, and 7-Day Onboarding must each message
**every active client** (not just `client_test`), so the CEO + multiple beta users all get their SMS.
Morning Check-in (`morningCheckin1`) is ALREADY done — use it as the reference pattern.

## Ground truth (verified)
- Shared base `appjnWxg9sB3PV7Da`. Active clients = profiles where `{active}=1`.
- Today 4 active rows; only `client_test` has a `ghl_contact_id`. Rows without a `ghl_contact_id` must
  be SKIPPED by the `send` guard (`!!ghl_contact_id`) — never crash, never send to a blank contact.
- GHL send: `POST https://services.leadconnectorhq.com/conversations/messages`, header auth cred id
  `fLewYZwvD9PfMAQJ` ("GHL Relentless"), headers `Version: 2021-04-15` + `Content-Type: application/json`,
  body `{ type:'SMS', contactId: <ghl_contact_id>, message: <text> }`.
- Airtable cred id `Z1DGfO9LPHXmAo4W`; Claude cred id `pcypOWLM78lgbOUQ`.
- Deploy via SSH (see `CLEANUP-TWILIO-TO-GHL.md` §1): key → /tmp/k chmod 600, `root@167.233.94.171`,
  stack `/root/n8n`, CLI `docker compose exec -T n8n n8n <cmd>`. import DEACTIVATES → re-`update:workflow
  --id=<id> --active=true` → `docker compose restart n8n` → wait ~25s.

## The multi-user pattern (how morningCheckin1 was fixed)
1. `loadProfile` Airtable node: `filterByFormula = {{ "{active}=1" }}`, `returnAll: true` (drop `limit`).
   → returns N profile items. n8n then runs every downstream node ONCE PER ITEM automatically, BUT only
   if downstream nodes read the CURRENT item (`$json` / `.item`), NOT `$('node').first()` / `.all()`.
2. The `send` guard stays `!!p.ghl_contact_id`; the GHL send reads `$json.ghl_contact_id` per item.

## Per-workflow work

### 1. Meeting Reminders (`meetReminder1`, gen `_build_meetings.py`) — EASIEST, do FIRST
Already multi-user (iterates meetings, each carries user_id→client_id, uses `.item` not `.first()`).
ONLY bug: it sends via **Twilio** (`sendReminder` node, `n8n-nodes-base.twilio`). Swap that node to the
GHL httpRequest pattern above; `contactId` = `{{ $json.ghl_contact_id }}` (buildSms already sets it).
Regenerate (`python _build_meetings.py`), run `node _sim_meetings.js` if present, deploy `_meetings.json`,
reactivate `meetReminder1`. No loop wrap needed.

### 2. Nudge Engine (`nudgeEngineGhl1`, file `_nudge_ghl.json`, gen `fix_nudge.py`/none)
`loadProfile`/`getBiometrics`/`getRecentNudges` have NO filterByFormula (they read the whole table).
`Create a record` already uses `$json.client_id`. The ONLY single-client bug is `buildNudgePrompt`:
it does `$('loadProfile').first()` (always profile #1) and mixes ALL clients' biometrics/nudges.
Fix = run the profile→...→record chain once per client:
- Set `loadProfile` filter `{active}=1`, `returnAll:true`.
- Insert a **Loop Over Items** (`n8n-nodes-base.splitInBatches`, batchSize 1) right after `loadProfile`;
  route its loop output through `getBiometrics → getRecentNudges → buildNudgePrompt → HTTP → extractNudge
  → sendNudgeGhl/Create a record`, and the "done" output to nothing.
- Add `filterByFormula = {{ "{client_id}='" + $json.client_id + "'" }}` to `getBiometrics` and
  `getRecentNudges` so each loads only the current client's rows. (loadProfile output exposes
  `fields.client_id`; normalize at the top of the loop if needed.)
- In `buildNudgePrompt` change `$('loadProfile').first()` → the current item (`$json` after a normalize),
  and `$('getBiometrics').all()` stays (now already scoped to this client by the filter).
Re-sim if a sim exists, deploy, reactivate `nudgeEngineGhl1`.

### 3. End-of-Day Score PRO (`eodPro00001ghl`, gen `_build_eod_pro.py` patches an export)
Heavy `.first()` use (`$('Search records').first()`, `fetchBusinessHealth` filters by it). Wrap the
per-client chain (profile search → scores → nudges → business health → computeScore → send) in a Loop
Over Items (batch 1) keyed on the active-profile list, and repoint each downstream filter + `.first()`
to the current client's `client_id`. Verify `computeScore` reads the current item. Deploy, reactivate
`eodPro00001ghl`. (Most intricate — do LAST; get nudge + meetings green first.)

### 4. 7-Day Onboarding (`onboard00001ghl`, gen `_build_onboarding.py`)
`loadProfile` filter `{client_id}='client_test'`, limit 1, downstream `.first()`. Change filter to
`AND({active}=1, {onboarding_day}>=1, {onboarding_day}<=7)`, `returnAll:true`, wrap in Loop Over Items
batch 1, repoint `.first()`→current item. Each client gets their own day-N message; then increment
`onboarding_day` per client (the existing increment must target the current row's record id, not a
hardcoded one). Deploy, reactivate `onboard00001ghl`.

## Definition of done
- For each of the 4: `import` + `--active=true` + restart, and a manual `n8n execute --id=<id>` (or the
  schedule) processes MORE THAN ONE active client without error, sending only to clients that have a
  `ghl_contact_id`. Confirm via `tbl_nudges` / `tbl_daily_scores` getting rows for >1 client_id.
- Update `reference/AUTO-PROVISIONING-PLAN.md` "Remaining senders" list as each is completed.
- Do NOT touch Weekly/Monthly/Market this pass (not daily-demo features) — leave single-client.
