# Relentless AI — App State + End-to-End Test Guide (2026-06-26)

## What the app IS
SMS AI executive-coaching managed service. **Two halves:**
- **Web app** (Next.js, Vercel `relentless-web.vercel.app`) — signup/login (Supabase), onboarding,
  dashboard (score, recovery, briefing, tasks, meetings, War Room, 90-day trend), `/diagnostic` funnel,
  `/connections` page.
- **Automation** (n8n on Hetzner `167.233.94.171.nip.io`) — daily/weekly/monthly SMS workflows via
  **GoHighLevel**, data in **Airtable** (per-client base), AI = Claude.

---

## ✅ DONE (live)
**Web:** Supabase auth + email confirm · `proxy.ts` route guard · onboarding · dashboard (real-time 30s
poll, task/meeting CRUD + GHL mirror, voice-to-task, War Room chat, pillar popovers, 90-day trend) ·
recurring weekly exec tasks (auto-seed) · `/diagnostic` (9-Q audit → lead capture to `tbl_leads`) ·
`/connections` (honest: Recovery+News active, rest "coming soon") · RLS verified · per-tenant isolation
verified · sidebar: Dashboard/Profile/Connections/Audit.

**Automation (all GHL, zero Twilio):** Morning Briefing · End-of-Day Score (4-pillar + Pro 6-pillar) ·
Nudges · Feedback · 7-Day Onboarding · Weekly Business Health (Pro) · Monthly Report · Stage Transition ·
Bad-Day Override · Market Intelligence · War Room · GHL inbound router · DLQ.

**Scoring engine:** pure tested modules (scoring 51, warRoom 45, pendingReplies 20, monthly 15, etc.).

## 🔴 REMAINING / NOT built
1. **Multi-client provisioning (THE big gap)** — automation is hardcoded to ONE client (`client_test`,
   base `appjnWxg9sB3PV7Da`). No flow creates a new client's Airtable base + GHL sub-account + n8n config.
2. **New-user → automation bridge** — see below. A new web signup is "unprovisioned": dashboard works
   (tasks/diagnostic) but **no SMS automation runs for them** until manually provisioned.
3. **6-app briefing sources** — Email/Slack/CRM/Sales/LinkedIn OAuth NOT built (Connections = roadmap).
4. **Wearable (Whoop/Oura) + Google Calendar OAuth** — not built; manual biometric mode is the path.
5. **Legal:** FL-attorney privacy policy (DRAFT) · **GHL A2P 10DLC FAILED** (no US SMS until approved).
6. **Heartbeat/SLA monitor** — off (was Twilio); rebuild GHL version.
7. **Ambient (Bee/Plaud)** · monthly retention-purge job · deletion-on-cancel — not built.

---

## ❓ Your questions answered

### "New user logs in → 'Your coaching isn't set up yet' — how does it get set up?"
**Today: MANUALLY, and the flow does not exist as automation.** When a user signs up, their Supabase
profile has **no `client_id` / `airtable_base_id`** → `/api/coaching` returns `not_provisioned` → that
banner shows. To "set them up" (per Master Spec Phase 0, ~6h manual), someone must:
1. Clone the Airtable TEMPLATE base for the client → get the new base id.
2. Add a `tbl_client_profile` row (client_id e.g. `client_002`, phone, plan, stage, goal, consent).
3. Create a GHL sub-account + contact → put `ghl_contact_id` on the profile.
4. (Wearable) Whoop/Oura + Google Calendar OAuth, or set `manual_biometric_mode=true`.
5. In **Supabase**, set that user's `profiles.client_id` + `airtable_base_id` (+ `ghl_contact_id`, `plan`)
   so the web app shows their real data.
6. Set `active=true` + `onboarding_day=1`.
> **This is the #1 thing to build for true multi-user:** a provisioning flow (admin action or automated)
> that does steps 1–6. Until then, each beta user is provisioned by hand. **The banner is correct — it
> means "we haven't provisioned your coaching workspace yet."**

### "When does the 7-day onboarding start delivering?"
The `7-Day Onboarding` workflow (GHL) reads `onboarding_day` (1–7) from `tbl_client_profile` and sends
that day's message daily ~6:30 AM, then increments. **It only runs for a PROVISIONED client whose profile
exists with `onboarding_day=1` and `active=true`.** So: onboarding starts the morning AFTER provisioning
sets `onboarding_day=1`. A brand-new web signup with no Airtable profile gets **nothing** until provisioned.

---

## 🧪 End-to-end test plan (next session, from scratch)
**A. New normal user (web):** signup (new email) → confirm → onboarding form → dashboard shows
"not set up yet" + sample data + own tasks (recurring auto-added) → add/complete task → `/diagnostic` →
`/connections` → confirm NO other user's data visible (RLS).
**B. Provisioned client (the demo `client_test`, +91 phone, plan=pro):** dashboard shows REAL score/
recovery/briefing/trend → trigger each n8n sender (briefing/score/nudge/etc.) → SMS arrives via GHL
(no trial prefix) → War Room chat live → Pro cards visible.
**C. Pro vs Standard gating:** flip `plan` on a profile → confirm War Room / Pro cards appear/hide.
**D. Inbound:** GHL inbound reply round-trip (recovery `4 3 2`, feedback YES/NO).
**E. Isolation:** two accounts, A's tasks invisible to B.

**Access:** n8n SSH = `build/n8n/hetzner/ssh/n8n_hetzner` (see `CLEANUP-TWILIO-TO-GHL.md`). GHL token =
`pit-350beac0-738f-4646-a098-28f6fff30a1c`. Audit cmd in `CLEANUP-TWILIO-TO-GHL.md` §2.
