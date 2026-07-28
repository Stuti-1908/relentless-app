# Switch SMS from Twilio → GoHighLevel (no more "trial account" prefix)

Everything is converted and ready. The only steps left are **clicks in the n8n UI** (the n8n API is
disabled on the server, and credential values can only be set in the UI). ~10 minutes.

GHL SMS was tested live and **a real text reached your phone** — so this works. (A2P only gates
US→US texts; your +91 test number is international, so it goes through.)

---

## STEP 1 — Update the GHL token in n8n (one place, fixes auth everywhere)
Your old GHL token was dead. The new one is:
`pit-350beac0-738f-4646-a098-28f6fff30a1c`

1. Open n8n (your laptop: http://localhost:5678 · cloud: https://167.233.94.171.nip.io)
2. Left menu → **Credentials**
3. Open **"GHL Relentless"**
4. Set the header **value** to: `Bearer pit-350beac0-738f-4646-a098-28f6fff30a1c`
   (header name stays `Authorization`)
5. **Save**.
   → This also fixes the dashboard's GHL task-sync, which was broken by the old token.

---

## STEP 2 — Import the GHL versions of each sender
The converted files are in `build/n8n/` (each has the Twilio node swapped for a GHL "send SMS" node):

| Import this file | Replaces the Twilio workflow |
|---|---|
| `briefing_intensity_ghl.json` | Morning Briefing |
| `_eod_pro_ghl.json` | End-of-Day Score (Pro 6-pillar) |
| `_monthly_ghl.json` | Monthly Report |
| `_weekly_ghl.json` | Weekly Business Health |
| `_onboarding_ghl.json` | 7-Day Onboarding |
| `_stage_ghl.json` | Stage / Weekly Plan |
| `_badday_ghl.json` | Bad-Day Override |

For **each** file:
1. n8n → **Workflows** → top-right **⋮** → **Import from File** → pick the file.
2. If it asks you to pick a credential for the GHL node, choose **"GHL Relentless"**.
3. Open the workflow → toggle it **Active** (top-right).
4. Open the **old Twilio version** of the same workflow → toggle it **Inactive** (so you don't get two sends).

---

## STEP 3 — Test
Open the Morning Briefing (GHL) workflow → **Execute workflow**. You should get the briefing on your
phone **with no "Sent from your Twilio trial account" prefix.** 🎉

---

## Still on Twilio (convert next — I need to export these or you send me their JSON)
- **Nudge Engine**, **Feedback Question**, **Inbound reply** (the recovery/feedback reply), **War Room reply**.
  These send via Twilio too. Once I can reach the n8n (working API key) or you export their JSON, I'll
  convert them the same way.

## To also RECEIVE replies via GHL (optional, later)
Right now inbound replies come through the Twilio webhook. To move inbound to GHL, add a GHL
**inbound-message webhook** that POSTs to the n8n inbound URL (`/webhook/twilio-inbound`). One-time setup.

## How the GHL send node works (for reference)
`POST https://services.leadconnectorhq.com/conversations/messages`
Header `Authorization: Bearer <pit token>` (the GHL Relentless credential) + `Version: 2021-04-15`
Body: `{ "type": "SMS", "contactId": <profile.ghl_contact_id>, "message": <the SMS text> }`
→ GHL sends from your A2P/LeadConnector number, so no trial prefix. Each client must be a GHL **contact**
(your test client already is: `v8lIYQuHTAcLFmbJ0HUt`).
