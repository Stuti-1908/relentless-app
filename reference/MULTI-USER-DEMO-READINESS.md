# Multi-User Demo Readiness — Beta Presentation (2026-06-24)

> Honest, grounded assessment for "multiple users use it simultaneously tomorrow." I traced the
> actual code + checked the live systems. Below is exactly what is multi-user-safe, what to demo,
> the ONE thing you must do first, and what you must NOT claim.

## TL;DR
- **Web dashboard = genuinely multi-user safe.** Many people can sign up + use it at once; each sees
  ONLY their own account. New signups correctly see sample data + a "not set up yet" banner — they do
  **not** see the demo client's real data. (Verified in code + live.)
- **Automation (the SMS coaching loop) = single-client.** Every n8n workflow is wired to ONE Airtable
  base (`client_test`). It runs the full loop for the ONE provisioned demo client — **not** for arbitrary
  new beta signups. Per the spec, each real client needs their own Airtable base + GHL sub-account +
  credentials (a ~6h Phase-0 provisioning). That is NOT built for N users and cannot be tonight.
- **ONE must-do before the demo:** confirm **Supabase RLS** so two logged-in testers can't see each
  other's tasks. 5 minutes. Details below.

---

## ✅ What IS multi-user safe (verified)
**1. Tenant isolation by design.** `clientContext.ts` reads each user's `client_id` + `airtable_base_id`
from THEIR Supabase profile row. A new user has neither →
- `/api/coaching` → `{configured:false, reason:"not_provisioned"}` → dashboard shows **sample data +
  banner**, never another tenant's real data.
- `/api/profile-sync` → no-ops (won't overwrite the demo client's Airtable record).
- `/api/warroom` → gated to `plan=pro` on the user's own Airtable profile → new users get the Pro gate.
- `/api/coaching` caches **per (base+client)** key → a user can never be served another tenant's cache.

**2. Per-user app data (Supabase).** Tasks, meetings, profile are keyed by `user_id`. Concurrent users
each get their own — **provided RLS is on** (see must-do).

**3. Concurrency.** The web app is stateless on Vercel (serverless) + per-base cache; simultaneous users
are fine. No shared mutable state leaks across requests.

**4. The funnel.** `/diagnostic` (public) and signup → onboarding → dashboard all work per-user.

## 🔴 The ONE must-do before you present
**Verify Supabase RLS** (per-user row isolation). I confirmed logged-OUT anon can't read the tables, but
could not verify logged-IN isolation without two accounts.
1. Supabase → SQL Editor → run `build/n8n/supabase_rls.sql` (own-row policies on profiles/tasks/meetings).
2. Run: `select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in
   ('profiles','tasks','meetings');` → expect `rowsecurity = true` for all three.
3. **Two-account test (do this live before the audience arrives):** sign in as User A, add a task; sign in
   as User B (incognito), confirm B does **NOT** see A's task. If B sees it → RLS is off → STOP and fix.

---

## 🎬 Recommended demo script (plays to what's real + impressive)
1. **The funnel** — open `/diagnostic`, answer a few, show the instant personalized diagnosis + lead
   capture. (Public, multi-user, no risk.)
2. **Multi-user dashboard** — have 2–3 audience members sign up live on their phones. Each lands on their
   OWN dashboard: their tasks, the recurring weekly exec tasks auto-added, voice-to-task, and a "your
   coaching workspace is being set up" banner. **This proves multi-user isolation live.**
3. **The full coaching loop** — on the ONE provisioned demo account (your phone, `client_test`): trigger
   a morning briefing / evening score / nudge → real SMS arrives via GHL. Show the dashboard updating in
   real time (30s poll), the 90-day trend, and the War Room (Pro) live AI strategy chat.
4. **Pro vs Standard** — show the dashboard gates Pro cards (War Room, etc.) on plan, so Standard users
   get a clean 4-pillar experience and Pro users get the business layer.

## ⛔ Do NOT claim in the demo (it isn't true yet)
- "Every signup immediately gets live SMS coaching." → They get the dashboard; SMS automation needs
  per-client provisioning (Phase 0). Frame new signups as "joining the beta — we provision your coaching
  workspace next."
- "The morning briefing replaces your 6 apps (email/Slack/sales…)." → Only news + recovery + priorities
  are live; email/Slack/sales aren't built (see `LAUNCH-READINESS-REVIEW.md` M1).
- US SMS at scale → blocked on GHL A2P (failed); international works, which is why the demo works.

## Spec conformance snapshot (Master Spec)
| Spec area | State |
|---|---|
| §3 schemas (all tbls) | ✅ exist in the `client_test` base |
| §6 Ph1 Briefing (stage-aware, manual biometric, calibration) | ✅ live (GHL) |
| §6 Ph2 Daily Score (4/6 pillars, labels) | ✅ live (GHL); Pro 6-pillar live |
| §6 Ph4 Nudges · §11 Feedback | ✅ live (GHL) |
| §5 7-Day Onboarding · §10 Bad-Day · §8 Stage transition | ✅ live (GHL) |
| §7 Ph7 Weekly Health · §8/Ph8 Market Intel · §6 Monthly | ✅ live (GHL) |
| §9 Manual biometric mode | ✅ tested module; ⚠ verify the morning 3-question SMS flow live |
| §6 Ph1 Calendar pull (Google) · §6 Ph3 Ambient (Bee/Plaud) · Whoop/Oura OAuth | 🔴 NOT built (need per-client OAuth) |
| §1 Legal (FL attorney policy) · A2P 10DLC | 🔴 blockers for PAYING US clients |
| **Multi-client provisioning (separate base/GHL/creds per client, §12)** | 🔴 **single-client only — the core multi-tenant automation gap** |

## The real "multi-user automation" gap (be clear-eyed)
The spec's model is **one Airtable base + GHL sub-account + n8n credential set per client**, with a
scheduler fanning out to per-client sub-workflows. Today the automation is **single-tenant** (hardcoded
`client_test`). Turning it multi-client is the god-plan §3.3 work: a per-client registry + a
scheduler→sub-workflow pattern + a provisioning runbook. That is a multi-day build, not a tonight fix.
**For the beta:** demo the multi-user WEB + the single-client AUTOMATION, and position automation as
"provisioned per client as we onboard you."
