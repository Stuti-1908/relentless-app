# Deploy When Ready — one-shot bundle (2026-07-03)

All phases are BUILT + VERIFIED offline. Nothing is live yet. When you're ready, run the steps below
once and everything ships together. Two independent deploys: **n8n** (direct-DB, one script) and
**web app** (Vercel, one command).

---

## What ships (all verified offline)

| Phase | Fix | Verified |
|---|---|---|
| 1a | 5 senders now message EVERY client at their local hour (was: only client #1) | 6/6 sim |
| 1b | stageTrans + eodPro loop per-client (per-client scores/biometrics) | 14/14 topology |
| 0.4 | DONE/SKIP/score replies close the RIGHT pending row; stale rows can't hijack | 25/25 unit + 8/8 live-scenario |
| 3 | contactRepair1 backfills the 8 clients with no GHL contact (every 6h) | wiring verified |
| 4 | briefings are daily-unique + energy/stress/sleep-aware + anti-repetition | 11/11 sim |
| 5 | SLA monitor: no more false "15h ago" alert; names the client actually missing | 4/4 sim |
| 2 | worldwide timezone picker (418 zones) on signup + profile | tsc clean |
| 6 | WhatsApp-for-non-US: **decision doc only** — see `build/n8n/PHASE6-whatsapp-channel.md` |

---

## STEP 1 — Deploy n8n (direct-DB, ~3 min)

Copy the deploy folder to the host, then run the wrapper. From your machine:

```bash
# 1. ship the deploy files + scripts to the host
scp -i ~/.ssh/id_dadaai -r "d:/DIGITAL DADA/GoeCoach-Plan/build/n8n/_deploy_p1/." \
    root@167.233.94.171:/root/deploy_p1/
scp -i ~/.ssh/id_dadaai \
    "d:/DIGITAL DADA/GoeCoach-Plan/build/n8n/_DEPLOY_ALL_direct_db.py" \
    "d:/DIGITAL DADA/GoeCoach-Plan/build/n8n/_DEPLOY_run_on_host.sh" \
    "d:/DIGITAL DADA/GoeCoach-Plan/build/n8n/_expire_stale_pending.js" \
    root@167.233.94.171:/root/deploy_p1/

# 2. run the deploy on the host
ssh -i ~/.ssh/id_dadaai root@167.233.94.171 "bash /root/deploy_p1/_DEPLOY_run_on_host.sh"
```

The wrapper: copies the live DB out, runs a DRY RUN (backup + per-workflow fix assertions — aborts if
any fix is missing), APPLIES the writes, stops n8n, swaps the DB in, restarts, and prints the active
state. A timestamped backup + rollback command are left in `/root/deploy_p1/`.

### Then clear the 22 stale pending rows (so DONE/score replies work cleanly)
```bash
ssh -i ~/.ssh/id_dadaai root@167.233.94.171 \
  "AIRTABLE_PAT=<your_airtable_pat> node /root/deploy_p1/_expire_stale_pending.js --apply"
```
(Run without `--apply` first to see what it'll expire.)

### Rollback (only if something looks wrong)
The wrapper prints the exact rollback command. It restores every workflow from the pre-deploy backup
and removes the newly-inserted contactRepair1.

---

## STEP 2 — Deploy the web app (Vercel, ~2 min)

Ships: worldwide timezone picker (signup + profile), plus everything queued from before (Yesterday's
Score label, recurring-reminder UI, Gmail connector, tour blur fix).

```bash
cd "d:/DIGITAL DADA/GoeCoach-Plan/relentless-web" && vercel deploy --prod --scope dwayne-s
```

### Optional web follow-up (Phase 3 provisioning hardening)
The 8 existing gap clients are fixed by contactRepair1 (Step 1). To stop NEW gaps, apply the small
retry+logging diff to `relentless-web/src/app/api/provision/route.ts` described in
`build/n8n/PHASE3-provisioning-notes.md` §3a, then redeploy. Not urgent — the repair job covers it.

---

## STEP 3 — Verify it's working (next morning)

- Watch `slaMonitor1`: the daily false "15h ago" alert should STOP. If a real client misses their
  morning send, you'll get an alert that NAMES that client.
- Check 2+ clients in different timezones each get their OWN briefing at their local 6 AM.
- Reply "DONE" to a recurring reminder → the pending row should close (status=matched).
- Dashboard "Morning Briefing" card should show a NEW, different briefing each day.

---

## One decision still needed (Phase 6)
Non-US (+91/+234) numbers still won't get SMS (GHL/US-carrier limit). Pick: **US-only beta now** /
**US now + WhatsApp fast-follow** / **Twilio international SMS**. See
`build/n8n/PHASE6-whatsapp-channel.md`. Say which and I'll build it.

---

## Files (all in `build/n8n/`)
- `_deploy_p1/*.json` — the 11 fixed/new workflows
- `_DEPLOY_ALL_direct_db.py` — asserting direct-DB writer (+ rollback)
- `_DEPLOY_run_on_host.sh` — host orchestration wrapper
- `_expire_stale_pending.js` — stale-row cleanup
- `_BACKUP_live_workflows_20260702.json` — full pre-change backup (476KB)
- fix generators: `_fix_multiclient_v3.js`, `_fix_loop_rebuild.js`, `_fix_inbound_close.js`,
  `_build_contact_repair.js`, `_fix_briefing_intelligence.js`, `_fix_sla_monitor.js`
- verifiers: `_verify_multiclient.js`, `scratchpad/verify_loop.py`, `scratchpad/eval_briefing.js`,
  `scratchpad/eval_sla.js`, `scratchpad/verify_inbound.js`
