# Cleanup task: make all n8n messaging GHL-only (remove the Twilio/GHL mix)

> **For the next AI agent.** This is a self-contained implementation guide. The Relentless AI n8n
> instance has a MIX of Twilio and GoHighLevel (GHL) workflows. Some Twilio senders are still ACTIVE,
> so clients sometimes receive messages from Twilio instead of GHL. **Goal: every client-facing message
> goes out via GHL; no active Twilio senders; redundant Twilio infra deactivated.**
>
> Read `GoeCoach-Plan/HANDOFF.md` first for full project context. The two-way conversational build
> (Phases 1-4) is already live; this is a channel-consistency cleanup on top of it.

---

## 1. Where everything runs (READ THIS FIRST)

There is **no localhost n8n anymore** — the live production n8n is on a **Hetzner** box. You deploy
DIRECTLY to it over SSH. "Upload to Hetzner" = the import commands below.

- **Server:** `root@167.233.94.171` · public URL `https://167.233.94.171.nip.io`
- **SSH key:** `GoeCoach-Plan/build/n8n/hetzner/ssh/n8n_hetzner` (copy to /tmp + `chmod 600` first; OpenSSH
  refuses loose perms). Example:
  ```bash
  cp build/n8n/hetzner/ssh/n8n_hetzner /tmp/k && chmod 600 /tmp/k
  ssh -i /tmp/k -o BatchMode=yes root@167.233.94.171 'cd /root/n8n && docker compose ps'
  ```
- **n8n stack:** `/root/n8n` (docker compose, service name `n8n`). All n8n CLI runs as
  `docker compose exec -T n8n n8n <cmd>`.
- **Credential IDs (identical on Hetzner — whole n8n_data volume was migrated):**
  - Airtable: `Z1DGfO9LPHXmAo4W` · Claude/Anthropic (header auth): `pcypOWLM78lgbOUQ`
  - Twilio: `Iup3ZRFuOaK60uct` · **GHL (header auth): `fLewYZwvD9PfMAQJ`** ("GHL Relentless")
- **Airtable base:** `appjnWxg9sB3PV7Da` (client_test). Demo client `client_test`,
  `ghl_contact_id = v8lIYQuHTAcLFmbJ0HUt`, phone `+916355046464`, `plan = pro`.

### Deploy recipe (per workflow)
```bash
# upload + import (import KEEPS the id; it does NOT activate)
scp -i /tmp/k build/n8n/FILE.json root@167.233.94.171:/root/n8n/FILE.json
ssh -i /tmp/k root@167.233.94.171 'cd /root/n8n && \
  docker compose cp FILE.json n8n:/tmp/FILE.json && \
  docker compose exec -T n8n n8n import:workflow --input=/tmp/FILE.json'
# activate / deactivate
ssh ... 'docker compose exec -T n8n n8n update:workflow --id=<ID> --active=true'
ssh ... 'docker compose exec -T n8n n8n update:workflow --id=<ID> --active=false'
# restart (registers webhooks + cron schedules; ~25s; retry first webhook POST ~15-30s after)
ssh ... 'cd /root/n8n && docker compose restart n8n'
```

### ⚠️ Hard constraints / gotchas
- **`import:workflow` DEACTIVATES the workflow** → always re-`update:workflow --active=true` after import.
- **There is NO `n8n delete:workflow` CLI** (it returns "Command not found"). Deleting inactive clutter
  must be done in the **n8n UI** (`https://167.233.94.171.nip.io`). Cleanup via CLI = deactivate only.
- **Airtable v2.2 "update" node** needs `matchingColumns:["id"]` + the id inside `columns.value.id` —
  NOT a top-level `id` param (a top-level id silently fails with `onError:continue`).
- Filtering on a tbl_pending_replies singleSelect: `{status}='open'` works.
- Some workflow names are NON-unique across Twilio/GHL pairs — **always act by ID, never by name.**
- Don't touch the workflow named **`Thiago`** (`438pu0mCTVG5SkU4`) — it's a different client's.

---

## 2. Current state (audit, 2026-06-23)

ACTIVE workflows and their send channel. **The 6 marked 🔴 are the cleanup targets.**

| ID | Name | Channel | Action |
|----|------|---------|--------|
| `morningCheckin1` | Morning Check-in | GHL ✅ | keep |
| `briefBuilder1` | Briefing Builder | GHL ✅ | keep |
| `briefFallback1` | Briefing Fallback (7AM) | webhook ✅ | keep |
| `eodPro00001ghl` | End-of-Day Score PRO | GHL ✅ | keep |
| `weekly000001ghl` | Weekly Business Health | GHL ✅ | keep |
| `weeklySynth1` | Weekly Synthesis | GHL ✅ | keep |
| `badDayOverr1ghl` | Bad-Day Override | GHL ✅ | keep |
| `stageTrans01ghl` | Stage Transition | GHL ✅ | keep |
| `ghlInboundV1` | GHL Inbound Router | GHL ✅ | keep |
| `warRoom0001` | War Room | webhook ✅ | keep (router forwards to it) |
| `market000001` | Market Intelligence | Airtable-only ✅ | keep |
| `errHandler01` | Error Handler (DLQ) | Airtable-only ✅ | keep |
| **`0EAKsIekNAOKYmQH`** | **Nudge Engine** | 🔴 Twilio | **convert→GHL, swap** |
| **`meetReminder1`** | **Meeting Reminders** | 🔴 Twilio | **convert→GHL send, re-import** |
| **`monthly00001`** | **Monthly Report** | 🔴 Twilio | **swap to `monthly00001ghl`** |
| **`onboard00001`** | **7-Day Onboarding** | 🔴 Twilio | **swap to `onboard00001ghl`** |
| **`inbHardenedV1`** | **Inbound HARDENED** | 🔴 Twilio inbound | **deactivate (redundant — GHL router handles inbound)** |
| **`statusCallback01`** | **Twilio Status Callback** | 🔴 Twilio infra | **deactivate (Twilio-only)** |
| **`heartbeat01`** | **Heartbeat / SLA Monitor** | 🔴 Twilio alert | **deactivate (see §4 note)** |

### Re-run the audit yourself (verify channel per active workflow)
```bash
ssh -i /tmp/k root@167.233.94.171 'cd /root/n8n && \
  docker compose exec -T n8n sh -lc "rm -rf /tmp/wfa && mkdir -p /tmp/wfa && \
    n8n export:workflow --all --separate --output=/tmp/wfa >/dev/null 2>&1; \
    n8n list:workflow --active=true 2>/dev/null > /tmp/active.txt; \
    ACTIVE=\$(cut -d\"|\" -f1 /tmp/active.txt); \
    for f in /tmp/wfa/*.json; do \
      id=\$(grep -o \"\\\"id\\\": *\\\"[^\\\"]*\\\"\" \$f | head -1 | sed \"s/.*: *\\\"//;s/\\\"//\"); \
      tw=\$(grep -c nodes-base.twilio \$f); gh=\$(grep -c leadconnectorhq \$f); \
      echo \"\$ACTIVE\" | grep -qx \"\$id\" && echo \"\$id tw=\$tw gh=\$gh\"; \
    done"'
```

---

## 3. The GHL send pattern (how to convert Twilio → GHL)

A Twilio send node looks like:
```json
{ "type": "n8n-nodes-base.twilio", "credentials": {"twilioApi": {"id": "Iup3ZRFuOaK60uct"}},
  "parameters": { "from": "+14482429365", "to": "={{ ...phone... }}", "message": "={{ $json.reply }}" } }
```
Replace it with an **httpRequest to GHL** (the proven pattern used by every `*ghl` workflow, e.g.
`_eod_pro_ghl.json`):
```json
{ "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "onError": "continueRegularOutput",
  "credentials": {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}},
  "parameters": {
    "method": "POST", "url": "https://services.leadconnectorhq.com/conversations/messages",
    "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
    "sendHeaders": true,
    "headerParameters": {"parameters": [
      {"name": "Version", "value": "2021-04-15"}, {"name": "Content-Type", "value": "application/json"}]},
    "sendBody": true, "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ type:'SMS', contactId: <GHL_CONTACT_ID_EXPR>, message: $json.reply }) }}",
    "options": {} } }
```
**Key swap:** Twilio sends to a phone (`to`); GHL sends to a **`contactId`** = the Airtable profile's
`ghl_contact_id`. Pull it from whatever node loaded the profile, e.g.
`(($('loadProfile').first().json.fields || $('loadProfile').first().json).ghl_contact_id)`
(or `$('Search records')...` depending on the workflow's profile node name — inspect the file).

> Tip: there may be a `build/n8n/_convert_sms.py` helper from earlier; it converted Twilio→Twilio-SMS,
> NOT Twilio→GHL, so it is NOT sufficient here. Convert the send node as above (by editing the
> generator if one exists, e.g. `_build_*.py`, else patch the JSON directly), keep the message text
> expression, and point `contactId` at the profile's `ghl_contact_id`.

---

## 4. Step-by-step cleanup

Do each step, then re-run the audit (§2) to confirm. **Act by ID.**

1. **Monthly → GHL.** A GHL version exists on disk: `build/n8n/_monthly_ghl.json` (id `monthly00001ghl`).
   - Check if it's already imported: `n8n list:workflow | grep monthly`. If missing, import it.
   - `update:workflow --id=monthly00001ghl --active=true`
   - `update:workflow --id=monthly00001 --active=false`

2. **Onboarding → GHL.** GHL version on disk: `build/n8n/_onboarding_ghl.json` (id `onboard00001ghl`).
   - Same pattern: import if missing → activate `onboard00001ghl` → deactivate `onboard00001`.
   - ⚠️ Note: onboarding should only open a `day7_feedback` conversation on **day 7**, not every day. The
     plain GHL swap fixes only the CHANNEL; the day-7-conditional conversation wiring is a separate TODO
     (don't blindly add `openConversation` unconditionally).

3. **Nudge Engine → GHL.** **No GHL version exists** — build one.
   - Source the active Twilio workflow `0EAKsIekNAOKYmQH` (export it), convert its Twilio send node to the
     GHL pattern (§3), give it a new id like `nudgeEngineGhl1`, save as `build/n8n/_nudge_ghl.json`.
   - The nudge's profile node provides `ghl_contact_id`. Import → activate `nudgeEngineGhl1` → deactivate
     `0EAKsIekNAOKYmQH`.
   - Optional (Phase-4 follow-up): after the GHL send, add an `openConversation(nudge_reply, ~6h)` node
     (reuse `build/n8n/_add_open_conversation.py`) so nudge replies feed the Focus score via the router.

4. **Meeting Reminders → GHL.** Workflow `meetReminder1` (`build/n8n/_meetings.json`, generator
   `build/n8n/_build_meetings.py`) currently has a **Twilio** send node (`sendReminder`).
   - Edit `_build_meetings.py`: replace the Twilio `sendReminder` node with the GHL httpRequest (§3).
     The reminder needs the contact's `ghl_contact_id` — it already resolves the phone via
     profiles→Airtable; extend that to also carry `ghl_contact_id` and send to it.
   - Regenerate (`python _build_meetings.py`), re-run `node _sim_meetings.js`, import `_meetings.json`,
     reactivate `meetReminder1`.
   - ⚠️ Meeting reminders also depend on the Supabase service key env (`SUPABASE_SERVICE_KEY` in
     `/root/n8n/.env`) — unrelated to the channel; leave it.

5. **Deactivate redundant Twilio infra** (no GHL equivalent needed; the GHL router + GHL delivery replace them):
   - `inbHardenedV1` → `--active=false` (Twilio inbound; the GHL inbound router `ghlInboundV1` handles all inbound now).
   - `statusCallback01` → `--active=false` (Twilio delivery-status receiver; Twilio-only).
   - `heartbeat01` → `--active=false`. It alerts the operator via **Twilio** if today's `tbl_briefings`
     row is missing — but the new 2-step morning (Briefing Builder) may not write `tbl_briefings`, so it
     can false-alarm. Deactivate now; **TODO:** rebuild a GHL-based SLA monitor against the new morning
     flow if an internal heartbeat is still wanted.

6. **Restart + verify.**
   - `docker compose restart n8n`, wait ~25s.
   - Re-run the §2 audit command → confirm **NO active workflow shows `tw>0`** (all senders GHL).
   - Smoke webhooks: `curl -s -o /dev/null -w "%{http_code}" -X POST https://167.233.94.171.nip.io/webhook/ghl-inbound -d '{}'` → 200.

7. **Delete the inactive clutter (n8n UI — CLI cannot delete).** In `https://167.233.94.171.nip.io`,
   delete the now-inactive Twilio duplicates and scaffolding to de-clutter:
   - Twilio duplicates: `weekly000001`, `eodPro00001`, `badDayOverr1`, `stageTrans01`, `monthly00001`,
     `onboard00001`, `0EAKsIekNAOKYmQH`, `D6u7ItI5CjwOlW75` (old briefing), `xRaDYtW7kySPKQjO` (old feedback),
     `Y3ZygXA12WXfs7Hh` (old inbound), `inbHardenedV1`, `statusCallback01`, `heartbeat01`.
   - Scaffolding/util/clones: `ghlConnTest00001`, `ghlMkContact0001`, `ghlMkContact001`, `wfReadProfile001`,
     `wfSetContactId01`, `ghlMkTasks0001`, `ghlGetTasks0001`, `eodGhlClone0001`, `mkNudges00001`,
     `nudgeSearchTst`, `inbNudgeClone1`, `eodFocusClone1`, `dbgInbound01`, `dlqTest0001`, any `*Debug*`.
   - ⚠️ Verify each is INACTIVE and you recognize it before deleting. NEVER delete `Thiago`
     (`438pu0mCTVG5SkU4`) or any active GHL workflow from the §2 keep-list.

---

## 5. Definition of done
- The §2 audit shows **every active sender on GHL** (zero `tw>0` among active workflows).
- A live test (inject an inbound via the GHL "Add Inbound Message" API — recipe in `HANDOFF.md`) round-trips
  and the reply arrives via GHL.
- Inactive Twilio duplicates + scaffolding deleted in the UI.
- `HANDOFF.md` updated with the final all-GHL active set.
