# Relentless AI & Relentless AI Pro — Complete Managed Service Build Plan ("God Plan")

> **Version:** v3 (2026-05-31) — final consensus pass (Critic APPROVE). CR-2 stale-text regression purged; CR-9/10/11 genuinely implemented.
> **Status:** Implementation-ready production plan (RALPLAN consensus, deliberate mode)
> **Owner:** Digital Dada Technologies | **Builder:** Raj (n8n) | **Author:** Planner agent
> **Source of truth for spec:** `D:\DIGITAL DADA\GoeCoach-Plan\reference\SPEC-EXTRACTED.md`
> **This file:** `D:\DIGITAL DADA\GoeCoach-Plan\GOECOACH-GOD-PLAN.md`
>
> **Changelog v1 → v2 (consensus fixes):**
> - **CR-1:** Re-architected per-client execution to the **Scheduler → per-(client) Sub-Workflow → HTTP-Request
>   nodes with expression-injected auth** model (no runtime credential selection on native/OAuth2 nodes, which
>   n8n cannot do). See new §3.3 *Execution Model* (canonical), referenced everywhere.
> - **CR-2:** Replaced the wrong **23-hour** Whoop refresh with **just-in-time refresh** (Whoop access tokens
>   expire in 3600s; refresh tokens rotate). Single-flight, atomic rotated-token persist, `offline` scope.
> - **CR-3:** Added n8n executions/day quantification at 1/5/10/20 clients + per-due-window crons + 70%/90%
>   quota alerts.
> - **CR-4..CR-11, M1..M8:** scoring extracted to tested pure functions; idempotency claim + resume contract;
>   Airtable-backed reply state machine; heartbeat ships with Phase 1; table count reconciled; unmapped spec
>   items owned; under-specified formulas pinned; subjective ACs made deterministic; plus all MINOR items.
> - **ADR (§15) finalized.**
>
> **Changelog v2 → v3 (final-pass fixes — verified by fresh Critic):**
> - **CR-2 (regression purge):** removed stale "23h" Whoop-refresh text in the cross-cutting job, prereq table (§4.2), provisioning runbook, security (§8), observability (§9), and open questions (§14) — all now point to the JIT model (§5.0.6). The contradiction that would have led a builder to build the broken loop is gone.
> - **CR-9:** added owned + estimated workflows for the weekly `current_avoidance_pattern` detection job and the **data-driven** Day-5 / Day-7 onboarding messages.
> - **CR-10:** pinned the Body band **linear interpolation** rule and the Capital/Risk **[0,100] clamp** (new §5.0.9).
> - **CR-11:** converted the momentum-tone, supportive-tone, and feedback-influence acceptance criteria into **deterministic** checks (keyword/banned-phrase asserts + rubric grader + prompt-payload inspection).
> - Cleanups: §11 quota alert → 70%/90%; §10.1 "by hand" → §5.0.8 automated harness; heartbeat now an explicit Phase-1 deliverable in the §12 gantt.
>
> This is a durable, self-contained plan usable "anytime, anywhere" by any competent n8n builder. Where the
> spec already defines exact formulas/schemas/prompts, this plan references them precisely rather than
> re-deriving. Section/Phase numbers below refer to the spec unless stated otherwise.

---

## 1. Executive Summary

### What we are building
A **fully managed, per-client AI executive-coaching service** for CEOs and entrepreneurs at companies doing
$500K+ annually. Digital Dada *operates* the system on behalf of each client — this is **not** a self-serve
SaaS product. Each client receives an **isolated** stack: their own Airtable base, their own GoHighLevel (GHL)
sub-account, and their own dedicated set of n8n credentials. No workflow ever cross-queries two clients.

The product delivers a daily coaching loop over SMS:
- **Morning briefing (6:00 AM client-local):** AI-generated, stage-aware, biometrics-informed top-3 priorities.
- **Real-time nudges (every 90 min, 8 AM–7 PM):** context-aware focus prompts.
- **Evening Executive Score (7:00 PM):** a 0–100 composite across 4 pillars (Standard) or 6 pillars (Pro).
- **Ambient task capture (experimental):** transcripts → extracted tasks in GHL.
- **Weekly + monthly intelligence:** business-health check-ins (Pro), market signals (Pro), monthly reports.

Two product tiers:
- **Standard ($500–$1,500/mo):** 4 pillars (Body, Focus, Execution, Alignment) — personal performance coaching.
- **Pro ($2,000–$3,500/mo):** 6 pillars (adds Capital, Risk) — business-intelligence layer on top of Standard.

The system is orchestrated entirely in **n8n** (8 workflows / phases), with **Claude** as the AI brain,
**GHL** as CRM + SMS/email, **Airtable** as the datastore (11 tables), **Twilio** as SMS backup, **Whoop/Oura**
for biometrics (or a manual self-report fallback), **Google Calendar** for schedule intelligence, and a
**news API** (NewsData.io primary) for Pro market intelligence.

### End-state definition of done
The build is "done" when **all** of the following are true:

1. **Both legal gates are cleared** (see §7): (a) Florida-attorney-drafted Privacy Policy + ToS covering
   biometric, ambient-audio, calendar, and business-financial data are published and linked; (b) biometric +
   ambient consent flows are built, and consent is captured/timestamped/stored per client before any data pull.
2. **A2P 10DLC** brand + campaign registration is **approved** (independent launch blocker, see §7).
3. **All 11 Airtable tables** exist per the spec schema (§3), in a per-client base template.
4. **Standard tier (Phases 0–6) is fully built and stable**, and **one test client has run a complete daily
   loop end-to-end** (morning briefing → nudges → evening score → feedback) — the Week-3 milestone.
5. **Pro tier (Phases 7–8) plus all cross-cutting features** (stage intelligence, manual biometric mode,
   bad-day override, feedback loop, stage-transition detection) are built and verified.
6. **The entire spec testing checklist (§13) passes** against a test client (both Standard and Pro paths).
7. **Per-client provisioning runbook** (§6 here) is documented and has been executed once end-to-end.
8. **Observability is live** (§9): failure alerts to the operator for SMS failures, API outages, and OAuth
   token-refresh failures; retries and a dead-letter path exist.
9. **Compliance jobs are live** (§7): monthly retention-purge job, and a documented deletion-on-cancel process.
10. **The first real paying client is activated** only after gates 1–2 and the full provisioning runbook complete.

---

## 2. RALPLAN-DR Summary (Decision Record)

**Mode:** DELIBERATE (high-risk: handles biometric + ambient + financial PII, regulated SMS, real money/clients).

### Principles (guiding constraints, in priority order)
1. **Client isolation is sacred.** One client per Airtable base, per GHL sub-account, per n8n credential set.
   No workflow ever reads across clients. Isolation beats convenience and beats DRY.
2. **Compliance gates the product, not the other way around.** No paying client goes live until legal +
   consent + A2P 10DLC are done. These run in parallel with the build but sit on the critical path to revenue.
3. **Standard fully stable before Pro.** Get one test client on a working daily loop by end of Week 3, then
   layer Pro. Never build Pro features on an unstable Standard base. (Mandated by spec §14.)
4. **Templatize everything per-client.** Provisioning must be a repeatable runbook (target: shrink ~6h/client),
   because the business model is N isolated clients, not one shared system.
5. **Fail loud, degrade gracefully.** Every external dependency (SMS, biometric API, calendar, news) must have
   a defined failure behavior, an alert, and — where the spec allows — a safe default (e.g. body=60 on missing
   biometrics) so a single API outage never silently breaks a client's day.

### Decision Drivers (top 3)
1. **Time-to-first-working-client and operational simplicity for a small team** (Raj builds, Dwayne/Raj
   operate). Favor managed services and low-ops choices over infrastructure we must babysit.
2. **Per-client isolation + credential blast-radius containment.** The architecture and hosting choice must