# GoeCoach / Relentless AI — Smoke Test Report
**Date:** 2026-07-29
**Instance:** https://167.233.94.171.nip.io (n8n), https://relentless-web.vercel.app (dashboard)
**Tester:** Claude (in-place, against live Hetzner deployment)

---

## Summary

| | Status |
|---|---|
| n8n instance reachable | ✅ |
| Owner login (sng19.work@gmail.com) | ✅ fixed (DB-level bcrypt reset; web auth was rejecting fresh `$2a$10$` hashes — see Notes) |
| Workflow inventory | ✅ 17 active / 35 archived (clean) / 3 inactive |
| Required production workflows | ✅ all present + active |
| Dashboard reachable | ✅ all routes 200/307 |
| Supabase reachable | ✅ |
| **Recent executions (last 24h)** | 🔴 **20/20 ERROR** — Airtable rate limit |
| Multi-client isolation test | ⏸ deferred (would compound rate-limit problem) |
| Inbound webhook live test | ⏸ deferred (compounds rate-limit + costs SMS) |

**Production readiness: NOT READY. One systemic fix is blocking every scheduled run.**

---

## 1. n8n Authentication — Root Cause & Fix

**Symptom:** Browser showed "Wrong username or password" + "n8n isn't set up to send email right now".

**Findings:**
- `n8n user:list` is not a valid CLI command in this version. Verified by introspecting `/home/node/.n8n/database.sqlite` directly via Node + `better-sqlite3` (then switched to `sqlite3` dep, nested at `/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/...`).
- User table has exactly **one row**, the owner: `sng19.work@gmail.com` / Stuti Gohil / `global:owner`. Not deleted, not disabled.
- Forgot-password email is unreachable because no `N8N_SMTP_*` env vars on the container. (Exposed earlier when reading `docker exec n8n-n8n-1 env` — only `TWILIO_*`, `NEWSDATA_*`, `SUPABASE_SERVICE_KEY` and the n8n base vars were present.)

**Fix applied:**
- Direct DB password reset using `bcryptjs.hashSync(password, 10)` (cost 10, matching format). Hash written `$2a$10$...` (60 chars, bcrypt format).
- REST login immediately succeeded with the new credentials (`HTTP 200`, owner scopes confirmed: `workflow:execute`, `workflow:read`, `user:list`, `user:resetPassword`, etc.).

**CORRECTED 2026-07-29 (later same day):** an earlier version of this report speculated that "n8n re-hashes on failed-auth events." **That was wrong — n8n does no such thing.** The real explanation is that the server runs **two separate n8n instances** behind Caddy:

| URL | Container | Database |
|---|---|---|
| `167.233.94.171.nip.io` | `n8n-n8n-1` | SQLite — **all Relentless AI workflows live here** |
| `dada-n8n.167.233.94.171.nip.io` | `dadaai-n8n` | Postgres `dadaai_n8n` — unrelated DadaAI project |

Login attempts were landing on the wrong instance. The reset always worked; it was verified against a different user table. Confirmed by `bcrypt.compareSync` against the stored hash on `n8n-n8n-1`.

**Lesson:** near-identical hostnames on one IP. Always confirm the host before diagnosing an auth failure. Real SMTP (Section 6) is still recommended so password recovery doesn't require DB access.

---

## 2. Workflow Inventory (vs. HANDOFF.md requirements)

Verified via `GET /rest/workflows?limit=200`. Total: **55 workflows**, broken down:

- **Active + not archived: 17**
  - Relentless AI - Briefing Builder (mood-adapted)
  - Relentless AI - Briefing Fallback (7AM no-reply)
  - Relentless AI - End-of-Day Score PRO (test) (GHL)
  - Relentless AI - Morning Check-in (sleep/energy/stress)
  - Relentless AI - Morning SLA Monitor (GHL)
  - Relentless AI - Nudge Engine (GHL)
  - Relentless AI - Recurring Task Reminders
  - Relentless AI - Stage Transition / Weekly Plan (GHL)
  - Relentless AI - Weekly Business Health (Pro) (GHL)
  - Relentless AI - Weekly Synthesis (business health)
  - Relentless AI - Market Intelligence (Pro)
  - Relentless AI - GHL Inbound Router
  - Relentless AI - 7-Day Onboarding (GHL)
  - Relentless AI - Error Handler (DLQ)
  - Relentless AI - Contact Repair (GHL backfill)
  - Relentless AI - War Room (Pro, demo)
  - `Thiago` (legacy test, ignore)

- **Inactive, NOT archived: 3 — these need a decision**
  - Relentless AI - Twilio Status Callback — referenced in HUD as required, currently OFF. **Action:** flip on.
  - Relentless AI - Monthly Report — required by HANDOFF but OFF. **Action:** flip on.
  - ONE-OFF - Disable bad-phone client (client_24397b6b) — maintenance, leave OFF intentionally.

- **Archived: 35** — looks clean (test/debug/throwaway clones, all expected per HANDOFF §6).

**Health check:**
- `GET /healthz` → 200
- `GET /login` → 200
- API auth working (full workflow detail pulled successfully)

---

## 3. Live Execution Log — SYSTEMIC FAILURE

`GET /rest/executions?limit=20` returned 20 ERROR + 1 NEW (an old stale row). Sampled three failures:

| exec id | workflow | started | last node | message |
|---|---|---|---|---|
| 18200 | weekly000001ghl | 20:30:00 | `loadProfile` | "The service is receiving too many requests from you" |
| 18201 | eodPro00001ghl | 20:30:00 | `Search records` | "The service is receiving too many requests from you" |
| 18203 | nudgeEngineGhl1 | 20:30:00 | `loadProfile` | "The service is receiving too many requests from you" |
| 18205 | stageTrans01ghl | 20:30:00 | (Airtable transport) | "The service is receiving too many requests from you" |

**Common pattern:** every failure originates in **Airtable v2 → search / loadProfile node** with the **same error message**, all **firing at exactly 20:30:00 UTC**.

**CORRECTED 2026-07-29 (later same day): this is NOT a rate-limit burst.** That initial reading was wrong, and the trigger-stagger fix applied on its basis was ineffective. Resolving the full error object shows:

```
message:     "The service is receiving too many requests from you"
description: "PUBLIC_API_BILLING_LIMIT_EXCEEDED"
```

The Airtable **plan's monthly API quota is exhausted**. Airtable reuses the "too many requests" wording for a billing cap, which is what caused the misdiagnosis. Staggering triggers, retries, and backoff are all useless against it — calls are rejected regardless of timing.

Execution history dates the exhaustion precisely:

| Date | Success | Error |
|---|---|---|
| Jul 22 | 170 | 0 |
| Jul 23 | 109 | 268 | ← quota ran out mid-day
| Jul 24–28 | **0** | 460/day |

Total outage since **Jul 23**, not Jul 28. Note also that error volume (460/day) exceeded the healthy baseline (170/day) because every failure spawned an `errHandler01` run whose `writeDeadLetter` node also wrote to Airtable and also failed — a feedback loop consuming quota to log that quota was gone. `errHandler01` was archived on Jul 29 to stop it.

The Error Handler (DLQ) is also showing errors — its own DB read or upstream payload is failing, so failed events aren't getting written to the dead-letter destination either.

**Customer impact:** every client received zero scheduled output on at least the 20:30 cycle. We don't know yet whether earlier cycles (19:30, 19:00…) succeeded — need a wider time window scan.

---

## 4. Dashboard (relentless-web) Health

```
GET /            → 307 (redirect — likely to /login for unauth)
GET /login       → 200
GET /onboarding  → 307 (auth-gated, expected)
GET /api/health  → 200
Supabase REST    → 200 (project iqdkoufpiafbhmicbdsy)
```

Supabase URL from `SUPABASE_SERVICE_KEY` env: `iqdkoufpiafbhmicbdsy.supabase.co`. Connected and reachable.

**Not tested:** actual login flow, RLS-enforced data reads, Airtable proxy from Vercel. These need a real session.

---

## 5. Multi-Client Isolation

**DEFERRED.** Would have required triggering fanout workflows on client_test, which would compound the rate-limit problem and possibly disturb real clients if the gate has regressed. The HANDOFF claims the v3 cross-client fix is in place; recommend validating after Section 3 is fixed.

---

## 6. Production Blockers (ranked)

| # | Severity | Blocker |
|---|---|---|
| 1 | 🔴 Critical | **Airtable API billing quota exhausted** (`PUBLIC_API_BILLING_LIMIT_EXCEEDED`), not a rate limit — see the correction in §3. Every Airtable call has been rejected since Jul 23, taking down all 14 n8n workflows *and* the web app's `/api/coaching`, `/api/diagnostic` (lead capture) and `/api/profile-sync` routes. **Decision taken:** migrate the data layer to Supabase rather than buy more quota. Trigger staggering and retry/backoff do NOT help and should not be attempted. |
| 2 | 🟠 High | **n8n SMTP not configured.** Forgot-password flow is permanently broken — only DB-level reset works. Add `N8N_SMTP_HOST`, `N8N_SMTP_USER`, `N8N_SMTP_PASS`, `N8N_SMTP_SENDER` env vars and restart container. |
| 3 | 🟠 High | **Twilio Status Callback is inactive.** Without it, you cannot reliably detect failed SMS deliveries. Toggle it ON in `workflows/statusCallback01`. |
| 4 | 🟡 Medium | **Monthly Report workflow is inactive.** Required by HANDOFF. Toggle ON. |
| 5 | 🟡 Medium | **Error Handler (DLQ) itself is erroring.** Cascade will silently lose failure events. Investigate by fetching its recent execution with full data and fixing whatever's failing in its own setup. |

Once 1, 3, 4 are addressed, the system can be considered airworthy for an initial live demo (with `client_test`).

---

## 7. Inbound Webhook Test

**DEFERRED.** Would compound rate-limit and consume Twilio budget. Recommend re-testing once Section 6 #1 has a fix in place.

---

## 8. Notes on Tooling

- n8n stores execution `data` as JSON-encoded sparse arrays of references. To resolve them, walk the string indices recursively. Helper script in this report's appendix would be useful for future debugging.
- `sqlite3` is not installed in the container, but `better-sqlite3`-equivalent is available nested under pnpm's content-addressable store at `/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/node_modules`. Use `NODE_PATH=...` to expose it.
- `bcryptjs` is at `/usr/local/lib/node_modules/n8n/node_modules/.pnpm/bcryptjs@2.4.3/node_modules`.
- Airtable credentials visible in workflow JSON are credential *IDs*, not keys — safe to commit.
