# Auto-Provisioning Plan — new user → live coaching, no manual steps (2026-06-26)

**Goal:** when a user finishes onboarding, they are AUTOMATICALLY provisioned so (a) their dashboard
shows real data and (b) the n8n automation sends them SMS — no manual Phase-0.

## Design decision: shared base, per-client_id (not base-per-client)
The Master Spec wants a separate Airtable base per client. For automated multi-user (and the CEO test),
we use **one shared base (`appjnWxg9sB3PV7Da`) with a unique `client_id` per user.** Every table already
filters by `client_id`, so clients coexist safely. (Base-per-client can come later for true isolation.)

## Two halves

### Half 1 — Web provisioning (BUILD NOW) = `/api/provision`
Called automatically when onboarding saves. Server-side, uses the user's session + server tokens:
1. Skip if the user already has `client_id` (idempotent).
2. Generate `client_id = client_<8hex>`.
3. **GHL:** create a contact (name/phone/email) → `ghl_contact_id`.
4. **Airtable:** create `tbl_client_profile` row — client_id, full_name, phone_number(E.164), email,
   plan, business_stage, top_priority_1=goal, ghl_contact_id, onboarded_date, `active=true`,
   `onboarding_day=1`.
5. **Supabase:** update the user's `profiles` row — `client_id`, `airtable_base_id` (shared base),
   `ghl_contact_id`, `plan` (own-row update; RLS allows). → dashboard now shows real (empty-but-live) data.

### Half 2 — n8n automation fan-out (REMAINING)
Senders currently filter `{client_id}='client_test'` and process ONE profile. To serve all users:
- Change each sender's profile read to **all active clients** (`{active}=1`) and **loop** (n8n splits
  items → each runs the send per client). Senders: briefing, EoD, nudge, feedback, onboarding, weekly,
  monthly, stage, bad-day, market.
- Each already pulls `ghl_contact_id` from the profile row, so per-client send works once it loops.
- Deploy via SSH to Hetzner (see `CLEANUP-TWILIO-TO-GHL.md`).
- **7-day onboarding** then auto-starts: provisioning sets `onboarding_day=1` → the workflow sends Day-1
  next morning and increments daily.

## CEO test (tomorrow)
CEO signs up → onboarding → `/api/provision` runs → dashboard live + Airtable/GHL ready. Once Half 2 is
deployed, the CEO gets the morning briefing + score + nudges via GHL SMS (A2P now approved).

## Status
- Half 1: built (`/api/provision`, wired into onboarding).
- Half 2: briefing fan-out = in progress; rest = follow-on.
