# Phase W1 — Write path: Profile → Airtable

> **Goal:** what you enter in the web app (name, mobile, timezone, top priority) gets written into
> Airtable `tbl_client_profile`, so the **real morning briefing and nudges** use YOUR inputs —
> not hardcoded test data. This turns the app from read-only into the control panel for the SMS service.

**Status:** ⬜ not started · **Effort:** M (1 session) · **Depends on:** profile form (#4), read bridge (#7)

---

## Why this matters
The n8n Morning Briefing reads `tbl_client_profile.top_priority_1/2/3`, `timezone`, `phone_number`,
`full_name` to build the prompt + decide when/where to text. Right now those come from whatever's in
Airtable. After W1, editing your profile in the web app updates them — so the next briefing reflects it.

---

## 👤 You do (one-time, ~1 min)
1. Go to **https://airtable.com/create/tokens** → open the **`Relentless Web App`** token.
2. Under **Scopes**, click **+ Add a scope** → add **`data.records:write`** (keep the two read scopes).
3. **Save**. (No new token to copy — same one gains write access.)
4. Tell me the **client_id** of your test client, OR let me read it (I'll pull the single row from
   `tbl_client_profile` and confirm it with you — it's likely `client_001`).

---

## 🤖 I build
1. **Confirm the target client** — read `tbl_client_profile` from base `appjnWxg9sB3PV7Da`, grab the
   `client_id` of the (single) row. Pin it in `.env.local` as `AIRTABLE_CLIENT_ID` for now (W3 makes
   this per-user).
2. **New server route `POST /api/profile-sync`** (token stays server-side):
   - Input: the saved Supabase profile (full_name, phone, timezone, primary_goal).
   - Action: **PATCH** the matching `tbl_client_profile` record →
     `full_name`, `phone_number` (E.164), `timezone`, `top_priority_1 = primary_goal`
     (priorities 2/3 left as-is unless we add fields later).
   - Find-or-create: match by `client_id`; if no row, create one (guarded behind an env flag so we
     don't accidentally pollute the base).
3. **Call it from onboarding save** (and the future profile-edit screen, P1): after the Supabase
   `upsert`, fire `POST /api/profile-sync`. Non-blocking; show a small "Synced to coaching ✓" note.
4. **Two-way consistency:** also mirror `timezone`/`phone` back into the Supabase profile if Airtable
   already had values (so the dashboard + backend never disagree).

---

## Data mapping (Supabase profile → Airtable tbl_client_profile)
| Web profile field | Airtable field | Notes |
|-------------------|----------------|-------|
| full_name | full_name | |
| phone | phone_number | store E.164, keep as Text |
| timezone | timezone | IANA string, drives 6 AM trigger |
| primary_goal | top_priority_1 | the #1 priority the briefing leads with |
| company / role | *(no field yet)* | optional: add `company`/`role` to schema later |
| (consent in Supabase) | biometric_consent_given etc. | optional sync later; backend gates on these |

---

## ✅ Verification (must pass before "done")
1. Change your **top priority** in the web onboarding/profile → Save.
2. I read `tbl_client_profile` and confirm `top_priority_1` now equals the new text. (Automated check.)
3. **Trigger a fresh morning briefing in n8n** (manual run of the Briefing workflow) → confirm the
   generated briefing text references your new priority. (You'll see it on the dashboard's Morning
   Briefing card, since that reads the latest `tbl_briefings` row.)
4. Confirm `phone_number`/`timezone` updated.

---

## Risks / gotchas
- **E.164 formatting:** the SMS needs `+1XXXXXXXXXX`. I'll normalize in the route and reject junk.
- **Don't write to the TEMPLATE base** — only the client base (`appjnWxg9sB3PV7Da`). Hard-coded guard.
- **Field name drift:** if SCHEMA.md and the live base differ, the PATCH 422s. I'll read the schema via
  the Meta API first and map defensively.
- **Twilio trial:** real SMS to your India number is blocked; verify briefing *content* via the dashboard
  / WhatsApp Sandbox, not a live US text.

---

## Deliverables
- `src/app/api/profile-sync/route.ts`
- onboarding/profile calls it on save
- `.env.local`: `AIRTABLE_CLIENT_ID`
- a short `WEB-05-profile-write.md` "what changed + how to test" note
- HANDOFF.md updated
