# Phase F1 — Future / Pro features (the long roadmap)

> **Goal:** capture everything beyond the Standard daily loop so it isn't forgotten. These are larger,
> later, and several are **Pro-only**. Build after the Standard web↔SMS loop is solid + deployed.

**Status:** ⬜ backlog · **Effort:** XL (multi-week) · **Depends on:** W1–W3, P1, D1

> Source of truth for product scope: `GoeCoach-Plan/reference/RELENTLESS-AI-SPEC.md` (canonical
> 2026-06-03 master) + `GoeCoach-Plan/GOECOACH-GOD-PLAN.md`. War Room = Phase 9, **Pro-only, build LAST.**

---

## 1. Client View (the day-to-day exec screen)
A focused, mobile-first view for the end client (vs the current dashboard): today's score, briefing,
top 3, tasks, "reply by SMS" parity. The top-nav `Client View` tab points here.

## 2. Admin View (your operator console)
For you/Digital Dada to run the service:
- list all clients (from `tbl_clients_registry`), health at a glance (active, last briefing, last score)
- create/provision a client (ties into **W3**)
- see delivery logs (briefings/nudges/feedback per client)
- trigger a manual briefing / score run
- manage consent + plan (standard/pro)

## 3. Capital & Risk pillars (Pro)
Surface `capital_score` / `risk_score` (already in `tbl_daily_scores`, Pro-only) — remove the
"PRO · SOON" tags for Pro clients, wire the weekly **Business Health** check-in
(`tbl_business_health`) inputs from the web.

## 4. Weekly check-in + Monthly report in the web
- Weekly business check-in form (`tbl_business_health`) → feeds Capital/Risk + avoidance-pattern detection.
- Monthly report view (`tbl_monthly_reports`): trend, pillar averages, peak/recovery days, Claude insights.

## 5. Biometric connections (Whoop/Oura)
Replace manual recovery with real wearable OAuth (`tbl_oauth_tokens`, JIT refresh per the harness spec).
Consent gates already modeled (`biometric_consent_given`). Web = the consent + connect UI.

## 6. War Room (Phase 9 — Pro, build LAST)
On-demand strategic brainstorm (the spec's headline Pro feature). New table `tbl_war_room_sessions`.
Gate strictly on `plan = pro`. Do **not** start until the Standard loop is stable + deployed.

## 7. Notifications & realtime
- In-app/web push for "new briefing ready", "score posted".
- Supabase Realtime so tasks/score update live without refresh.

## 8. Two-way messaging in the web
Mirror the SMS conversation (briefings, nudges, replies, feedback) into a web thread — so the client can
respond in the app, not only by text. Reuses the inbound router logic.

## 9. Billing & plans
Stripe (or similar) for Standard/Pro subscriptions; gate Pro features on subscription status; tie to
`tbl_clients_registry.plan`.

## 10. Observability & ops
Error tracking (Sentry), uptime checks on the n8n webhooks, a status page, backups of Supabase + Airtable.

---

## Sequencing note
Rough order once Standard is live: **Admin View (2) → Client View (1) → Weekly/Monthly (4) →
Capital/Risk (3) → Biometrics (5) → War Room (6)**, with notifications/realtime (7), web messaging (8),
billing (9), and observability (10) slotted in as the client base grows.

Each of these gets its own detailed plan file when we pick it up — this file is the backlog index.
