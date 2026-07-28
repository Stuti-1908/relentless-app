# Relentless AI — Launch-Readiness Review (2026-06-23)

> Senior review for a "launch tomorrow" decision. Grounded in the **actual** code + **live** systems
> (Hetzner n8n, Vercel web, Supabase, Airtable, GHL) — not a generic checklist. Where I verified
> something live, I say so; where you must test by hand, I say that too. I did **not** rubber-stamp:
> a couple of headline items are not what they appear, and I call them out plainly.

## Verdict (one line)
**The Standard SMS coaching loop + dashboard are in good shape and could soft-launch to ONE
non-US (international) pilot. A true paying-client / US launch tomorrow is NOT advisable** — three
hard blockers (US SMS, legal, multi-user data isolation) are unresolved, and the "6-app morning
briefing" you're marketing is only partially built.

---

## 🔴 CRITICAL — cannot ship to a paying US client

### C1. GHL A2P 10DLC registration FAILED → no US SMS
Your own GHL Trust Center screenshot shows **"A2P 10DLC registration is incomplete/failed."** Every
client-facing message (briefing, score, nudge, feedback, onboarding, weekly, war room) now goes out
via GHL — which **cannot deliver to US numbers until A2P is approved.** International (+91 test) works,
which is why the demo looks fine. **This is the single biggest launch blocker for US clients.**
*Fix:* resubmit A2P in GHL Trust Center; approval takes days–weeks. Until then, US clients get nothing.
*Priority: CRITICAL — blocks the core product for the target market.*

### C2. Florida-attorney privacy policy is still DRAFT (legal gate)
Spec §1 makes an attorney-reviewed Privacy Policy + consent flow a launch gate. You collect biometric
+ business data; IL/TX/WA biometric laws carry $1,000–$5,000/violation. Onboarding still shows a
"⚠ DRAFT policy" banner. **Do not onboard a paying client against a draft policy.**
*Fix:* engage the FL attorney (owner still open per HANDOFF §6); publish + link the real policy.
*Priority: CRITICAL — legal exposure.*

### C3. Multi-user data isolation (RLS) is UNVERIFIED
I tested the Supabase REST API with the anon key and **no session → 0 rows** on `tasks`, `profiles`,
`meetings`. So a logged-OUT attacker can't read data (good). **But that does not prove a logged-IN user
is restricted to their own rows** — the actual multi-tenant risk. The own-row RLS policies
(`build/n8n/supabase_rls.sql`) were, per the task log, **never run**. If RLS is enabled without those
policies, behavior is undefined; if disabled, any authenticated user could read everyone's tasks/
profiles once you have >1 user.
*Fix (5 min, before a 2nd user exists):* in Supabase → SQL editor, run `supabase_rls.sql`, then verify
each table shows `rowsecurity = true` AND has the own-row policies. **Confirm with two real test
accounts that user A cannot see user B's tasks.** Today there's effectively one user, so it hasn't bitten
— it will the moment you share the link.
*Priority: CRITICAL the instant there is a 2nd user; safe-ish while single-tenant.*

---

## 🟠 MAJOR — fix before relying on it

### M1. The "Morning AI Briefing — replaces 6 apps" feature is NOT fully implemented
You asked me to confirm `morning-ai-briefing-carousel.pdf` is "fully implemented end-to-end." **It is
not, and I won't pretend otherwise.** That carousel markets one briefing that replaces **Email · Calendar
· CRM · Slack · Sales dashboard · News.** Reality on the box today:
- ✅ **News** — built (`market000001` market-intel) and a morning briefing exists.
- 🟡 **CRM (GHL)** + **Calendar (meetings)** — data is reachable but **not yet aggregated into the
  briefing**.
- 🔴 **Email (Gmail), Slack, Sales/revenue (Stripe)** — **not built at all**; each needs per-client OAuth
  you don't have yet.
So the headline claim ("replaces all 6, built once, delivered every morning") is **not deliverable**
today. The plan is in `reference/NEW-FEATURES-PLAN.md`. **Do not advertise the 6-app briefing until
Email/Slack/Sales are wired** — shipping marketing ahead of the feature is a trust/refund risk.
*Priority: MAJOR — it's the flagship pitch; ship the claim only when it's true.*

### M2. Undeployed local changes (prod is behind)
The 90-day trend window + the diagnostic "exactly·why" spacing fix are committed to the code and
**build clean**, but the deploy was interrupted — **production still shows the 30-day trend and the
spacing bug.** One `vercel deploy --prod` closes this.
*Priority: MAJOR — trivial fix, but prod ≠ your latest code right now.*

### M3. No silent-failure monitor on the morning send
The Twilio→GHL cleanup deactivated `heartbeat01` (the "did today's briefing actually go out?" alert) and
it was **not replaced**. If the GHL morning send silently fails, **no one is alerted** — the scariest
failure mode for a daily product (pre-mortem §11). The error-handler DLQ (`errHandler01`) still catches
*thrown* errors, but a silent no-send won't throw.
*Fix:* rebuild a GHL-based SLA monitor (Mon–Fri ~6:15, "did a briefing row land?" → alert). ~2h.
*Priority: MAJOR — reliability blind spot.*

### M4. Recurring-task seed is client-side + best-effort
The weekly recurring exec tasks seed in the browser on dashboard load (idempotent via a localStorage +
`meta` week marker). It works, but: (a) a user who never opens the dashboard in a given week gets no
recurring tasks that week; (b) the GHL mirror is fire-and-forget. Acceptable for now; know the
limitation. *Priority: MINOR–MAJOR depending on how central recurring tasks are.*

---

## 🟡 MINOR — nice to fix, won't block

- **Inactive Twilio duplicates clutter the n8n UI** — cosmetic; nothing sends from them. Delete in the
  n8n UI per `CLEANUP-TWILIO-TO-GHL.md` §7 (no delete CLI).
- **A `tbl_leads` test row** (`recTI9Vlb0Nrz1GXM`) from the diagnostic smoke test — delete.
- **No automated tests on the web UI.** The scoring engine is well-tested (scoring 51, warRoom 45,
  pendingReplies 20, monthly 15, etc.), but the dashboard/diagnostic/API routes have no tests — every
  refactor is "hope nothing broke."
- **`dashboard/page.tsx` is ~1,200 lines** — maintainable but overdue for a component split.
- **GHL contact dependency:** GHL sends to a `contactId`, so **every real client must be created as a GHL
  contact at onboarding** — make sure provisioning does this (the test client does).

---

## ✅ SOLID — verified working, don't touch
- **All SMS now via GHL** — live audit shows **zero active Twilio senders**; `/webhook/ghl-inbound` → 200.
- **Scoring/logic engine** — pure functions, comprehensively unit-tested. The trustworthy core.
- **Web app** — builds clean (16 routes), Supabase auth, `proxy.ts` route protection, server-only
  secrets (no token reaches the browser), per-tenant cache keyed by base+client (no cross-tenant bleed),
  same-origin CSRF guards on POST routes, `/api/health` probe.
- **Dashboard** — real-time (30s poll), interactive (task/meeting CRUD + GHL mirror, voice-to-task, War
  Room slide-over), professional design, Capital/Risk correctly removed.
- **SMB Growth Diagnostic** — live at `/diagnostic`, public, lead capture writes to `tbl_leads`.
- **Inbound** — GHL router handles inbound; signature/idempotency/DLQ patterns proven earlier.

---

## Pre-launch checklist (in priority order)
1. **[CRITICAL]** Resubmit + get **GHL A2P 10DLC approved** (US SMS). Until then: no US clients.
2. **[CRITICAL]** Publish the **FL-attorney privacy policy** + flip onboarding off "DRAFT".
3. **[CRITICAL]** Run **`supabase_rls.sql`**, verify `rowsecurity=true` + own-row policies, and **test
   user-A-can't-see-user-B** with two accounts.
4. **[MAJOR]** Decide the **briefing marketing claim** — either build CRM+Calendar+Email/Slack/Sales, or
   market only what ships (recovery + priorities + news).
5. **[MAJOR]** **Deploy** the pending web changes (90-day + spacing).
6. **[MAJOR]** Rebuild a **GHL morning-send SLA monitor** (silent-failure alert).
7. **[MINOR]** Delete inactive Twilio/scaffolding workflows; remove the test lead row.

## What I could NOT verify (you must, by hand, before launch)
- A real **GHL → user → GHL reply round-trip** end-to-end (I verified the webhook responds, not a full
  human round-trip).
- **Authenticated multi-user isolation** (needs two real accounts).
- A **real US-number SMS delivery** (blocked by A2P — can't test until approved).
