# Relentless AI — Demo Runbook

> Goal: show the full product end-to-end — daily loop, live dashboard, Pro 6-pillar score, and
> War Room — to a prospect. This is the **demo** bar, NOT a paying-client launch (no Florida
> attorney / A2P approval / 7-day soak required). Everything runs on the current laptop Docker +
> ngrok; you can demo War Room from a terminal (curl) with **no SMS at all**, or over SMS to a
> **US number** (see the SMS note).

---

## ⚠️ The one SMS constraint
Inbound SMS from an **Indian (+91) phone is carrier-blocked** to the US Twilio number — it never
arrives (this is not a Twilio-trial limit; upgrading does not fix it). So any demo where you **text
back** (recovery check-in `4 3 2`, feedback YES/NO, War Room) needs a **US number** on the phone
side. Easiest: a free **Google Voice** US number, or any US phone you control during the demo.
For outbound-only parts (briefing/score/nudge land on the phone) even +91 works.

**Tip:** War Room and the daily loop are both fully demoable **over HTTP (curl)** without any SMS —
great for a screen-share demo. See each section's "curl" line.

---

## 0. Pre-flight (once, before the demo)
1. `docker start n8n` → wait ~15s → confirm http://localhost:5678 loads.
2. Start the tunnel if using SMS: `wscript "C:\Users\sng19\...\Startup\ngrok-tunnel.vbs"` (or
   `ngrok http 5678`). Read the public URL from http://localhost:4040/api/tunnels.
3. Confirm the 4 senders + inbound + War Room are **Active** (n8n UI, green toggles):
   Morning Briefing, End-of-Day Score, Nudge Engine, Feedback Question, Inbound HARDENED, War Room.
4. (SMS demo) In Twilio console, set the +14482429365 number's "A MESSAGE COMES IN" webhook to
   `https://<ngrok>/webhook/twilio-inbound`.

---

## 1. Demo: Standard daily loop (on-demand, no waiting for 6 AM)
Each scheduled workflow also has a **manual trigger** — in the n8n UI, open the workflow and click
**"Execute workflow"** (or "Test workflow") to fire it live in front of the audience.

| Step | Action | What the prospect sees |
|------|--------|------------------------|
| Morning briefing | Execute "Morning Briefing" | SMS: a stage-aware top-3 priorities briefing, calibrated to recovery + energy |
| Recovery check-in | From the US phone, text `4 3 2` (sleep/energy/stress) | SMS back: "...your recovery today is N/100" + a row in `tbl_biometrics` |
| Executive Score | Execute "End-of-Day Score" | SMS: composite 0-100 + the 4 pillars (Body/Focus/Execution/Alignment) |
| Nudge | Execute "Nudge Engine" | SMS: a short context-aware focus nudge |
| Feedback | Execute "Feedback Question" → reply `YES`/`NO` | SMS confirmation + a `tbl_feedback` row |

**curl (no SMS) — recovery check-in:**
```
curl -X POST https://<ngrok>/webhook/twilio-inbound -d "From=+15551230000&Body=4 3 2&MessageSid=demo1"
```

---

## 2. Demo: Live dashboard
Open **https://relentless-web.vercel.app** → log in. Shows the **real** latest score, recovery,
briefing, 30-day trend, and the task list (create/complete a task live — it mirrors to GHL).
For a **Pro** account the dashboard also shows Capital/Risk pillars + Stage Intelligence (gated on
`plan=pro`; Standard users correctly never see Pro cards).

---

## 3. Demo: Pro 6-pillar score
Pre-req: the demo profile's `plan` = **pro** in `tbl_client_profile`, and one row in
`tbl_business_health` (cash_position + severity + manageability). Then import & activate the Pro EoD
(`_eod_pro.json`). Execute it → the SMS now reads:
`Executive Score 82/100 (Strong). Body 76, Focus 70, Execution 70, Alignment 100, Capital 85, Risk 80.`
(Standard clients stay 4-pillar — same workflow branches on `plan`.)

---

## 4. Demo: War Room (the Pro wow-feature)
Pro client texts **WAR ROOM** → a live first-principles strategic brainstorm that ends in a
committed 24h action (stored in `tbl_war_room_sessions`).

**Over SMS (US number):** text `WAR ROOM`, then follow the prompts.
**Over HTTP (best for screen-share) — drive the whole session from a terminal:**
```
U=https://<ngrok>/webhook/war-room          # or http://localhost:5678/webhook/war-room
F="From=+15551230000"
curl -s $U -d "$F&Body=WAR ROOM"             # -> activates, asks PROBLEM/OPPORTUNITY/STRATEGY
curl -s $U -d "$F&Body=PROBLEM"              # -> asks you to describe in one sentence
curl -s $U -d "$F&Body=Churn is killing us; solved = under 3% monthly churn"   # -> Claude pressure-tests + ONE probing question
curl -s $U -d "$F&Body=We never actually asked why they leave"                  # -> Claude synthesizes + commits an action + confidence
```
The final reply contains the **committed action** ("...within 24h. I will check in tomorrow.") and a
row lands in `tbl_war_room_sessions` (transcript, session_type, committed_action, final_confidence).

> Gate: a Standard (`plan != pro`) client texting WAR ROOM gets "War Room is a Pro feature" — show
> this too, it proves the tier gating.

---

## 5. Reset between demo runs
- War Room: the workflow treats a session as "active" until `committed_action` is filled. To start
  fresh, either complete the session (it closes itself) or clear the latest open
  `tbl_war_room_sessions` row.
- Daily loop: re-executing a workflow just adds new rows; no reset needed.

---

## What's demo-ready vs. still needed for a PAYING client
**Demo-ready now:** daily loop, dashboard, Pro 6-pillar, War Room (logic all tested).
**Before a paying client (not needed for the demo):** Florida-attorney privacy policy, A2P 10DLC
*approved*, real US number provisioned, 7-day soak, Hetzner migration (always-on host), WHOOP/Oura +
Calendar OAuth (or stay on manual biometrics). See `HANDOFF.md` for the full list + timeline.
