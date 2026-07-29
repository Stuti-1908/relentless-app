# Airtable → Supabase Migration

**Date:** 2026-07-29
**Status:** Awaiting user review
**Supersedes:** `2026-07-29-tz-personalization.md` (folded into this spec — see §7)

---

## 1. Why

Airtable's monthly **API billing quota is exhausted** (`PUBLIC_API_BILLING_LIMIT_EXCEEDED`). Every Airtable call has been rejected since **2026-07-23**, producing a total outage:

| Date | Success | Error |
|---|---|---|
| Jul 22 | 170 | 0 |
| Jul 23 | 109 | 268 ← quota ran out mid-day |
| Jul 24–29 | **0** | 460/day |

The error message Airtable returns is *"The service is receiving too many requests from you"*, which reads like a rate limit and initially caused a misdiagnosis. It is a **billing cap**. Staggering triggers, retries and backoff do nothing against it.

The blast radius is wider than n8n. These also depend on Airtable and are equally dead:

- `/api/coaching` — reads 9 tables; the client dashboard's coaching data
- `/api/diagnostic` — writes `tbl_leads`; **the lead-capture funnel**
- `/api/profile-sync` — writes `tbl_client_profile`

**Decision:** migrate the data layer to Supabase rather than buy more quota. The quota was consumed in ~23 days at current volume, so a larger plan defers the same outage rather than preventing it. Supabase has no per-call cap and is already in the stack (auth, `profiles`, `tasks`, `meetings`).

## 2. Decisions taken

| Question | Decision |
|---|---|
| Sequencing | **Phased.** Phase 1 restores the morning-briefing chain; Phases 2–3 follow. |
| Airtable's future role | **Fully retired.** Supabase becomes the single source of truth; admin via the Supabase table editor. |
| History | **Roster + ~90 days** of time-series, so dashboard charts still render. |
| n8n access method | **Native Supabase node**, with views absorbing queries it can't express. |
| Cutover | **Incremental per-workflow**, verified against `client_test` between each. |

## 3. Current state

**52 Airtable nodes** across 14 active workflows, one base `appjnWxg9sB3PV7Da`, 12 tables. Operations: 29 search, 16 create, 6 update, 1 upsert.

Supabase currently holds only `profiles` (20 cols), `tasks`, `meetings`.

**Crucially, `profiles` already contains the entire client roster** — all 11 clients, each with `client_id`, `full_name`, `phone`, `timezone`, `ghl_contact_id`, `plan`. Seven of the eleven columns originally proposed for a new `client_profile` table already exist there with live data.

### Live roster

| Client | Timezone | GHL contact |
|---|---|---|
| DWAYNE LEWIS | `Africa/Lagos` | ✅ |
| Oyaide Joshua Silver | ⚠️ `UTC` | ✅ |
| Bhakti Mamtora | `America/New_York` | ✅ |
| Luke | `America/New_York` | ✅ |
| Trupti Gohil | `America/New_York` | ✅ |
| Stuti S | `America/New_York` | ✅ |
| client_test | ⚠️ `Asia/Calcutta` | ✅ |
| 4 × test rows | mixed `UTC` | ❌ none |

Two data problems, independent of the migration:
- **`UTC` is a placeholder, not a real timezone.** Those clients get briefed at UTC-morning, which is wrong wherever they are. Needs correcting per client.
- **4 rows have no `ghl_contact_id`** and cannot receive SMS at all.

## 4. Schema (Phase 1)

Full runnable script: `build/migration/001_schema_phase1.sql`.

`client_profile` holds **only** the coaching fields Airtable has that `profiles` lacks — `active`, `onboarding_day`, `onboarded_date`, `top_priority_1`, `delivery_hour`, plus `phone_override` / `timezone_override` escape hatches for any Airtable-only legacy client. Identity stays in `profiles`.

Duplicating identity across two tables is precisely the split-brain the migration exists to remove, so the design refuses to do it.

`v_clients` joins the two into one flat row per client. **Every workflow's `loadProfile` node reads this view**, so no workflow performs a join:

```sql
create view public.v_clients with (security_invoker = on) as
select cp.client_id,
       coalesce(cp.timezone_override, p.timezone, 'America/New_York') as timezone,
       coalesce(cp.phone_override,    p.phone)                        as phone_number,
       p.full_name, p.ghl_contact_id, p.plan,
       cp.active, cp.onboarding_day, cp.onboarded_date,
       cp.top_priority_1, cp.delivery_hour
from public.client_profile cp
left join public.profiles p using (client_id);
```

Plus `pending_replies` and `briefings` as base tables.

### RLS

n8n uses the `service_role` key and bypasses RLS — correct for a trusted backend. Policies constrain the **browser** (anon key + user JWT) to the signed-in user's own client rows, via a `current_client_id()` helper. Read-only: all writes come from n8n. This is a genuine tightening over today, where the web app relies on a server-side Airtable token rather than row policies.

## 5. Node conversion

Most of the 52 conversions are mechanical, because the column-mapping expressions are pure n8n and carry over verbatim:

```js
"pending_id": "={{ 'pr_' + $now.toMillis() + '_morning_checkin' }}",
"opened_at":  "={{ $now.toISO() }}",
```

Only three things change per node:

| | Airtable | Supabase |
|---|---|---|
| type | `n8n-nodes-base.airtable` | `n8n-nodes-base.supabase` |
| target | `base` + `table` | `tableId` |
| read filter | `filterByFormula` string | structured `keyName`/`condition`/`keyValue` |

**Record identity is the one non-mechanical part.** Airtable nodes update rows by opaque `recXXXX` ids. Converted nodes key off natural business keys instead — `client_id` for profiles, `pending_id` for pending replies. Both carry `unique` constraints for this reason.

### Queries the Supabase node cannot express

The node's filter UI only ANDs simple comparisons. Three Airtable formulas exceed it:

```sql
-- briefFallback1 — contains an OR
AND({status}='open', OR({expires_at}='', IS_AFTER({expires_at}, NOW())))
-- slaMonitor1 — date arithmetic
AND({expected_type}='morning_checkin', DATETIME_DIFF(NOW(),{opened_at},'hours')<=26)
-- ghlInboundV1 — phone-normalising contact match
```

Rather than drop to hand-written SQL in Postgres nodes, this logic moves into **views** (`v_open_pending_replies`, `v_recent_morning_checkins`). The nodes then do plain unfiltered `getAll`s. Every node stays uniform, the complex logic sits in one reviewable place, and Postgres evaluates the time comparisons in UTC — removing a class of timezone bug that Airtable's formula engine could introduce.

`ghlInboundV1`'s matcher is the one case that may still need a Postgres node or an RPC. To be settled during implementation, not assumed away here.

## 6. Cutover

1. Run `001_schema_phase1.sql` in the Supabase SQL Editor (DDL cannot be done with the service key — PostgREST does data, not schema)
2. Import CSV history. **`pending_replies` rows import with `status='expired'`** — see §8
3. Convert `morningCheckin1`: `loadProfile` → `v_clients`, `openConversation` → `pending_replies`, `delivery_hour` into the `decide` code node
4. **Verify against `client_test` only** — set its `delivery_hour` to the current local hour, confirm exactly one message to one client
5. Then `briefBuilder1`, then `briefFallback1`, same pattern
6. Rollback at any point: re-`PUT` the snapshot from `build/n8n/_snapshot_pre_supabase_20260729/`

**Gate before enabling all 11 clients:** one clean cycle where `client_test` is briefed at its correct local hour and the other ten receive nothing.

## 7. Timezone personalization (folded in)

The separate TZ spec is superseded. Its substance lands here at near-zero extra cost, because the conversion already rewrites the `decide` code nodes that hold the TZ gates.

Audit of the existing gates:

| Workflow | Gate | Target hour |
|---|---|---|
| briefFallback1 | ✅ | 7 |
| eodPro00001ghl | ✅ | 19 |
| market000001 | ✅ | 5 (global — leave alone) |
| morningCheckin1 | ✅ | 6 |
| **nudgeEngineGhl1** | ❌ **none** | fires hourly for every client |
| onboard00001ghl | ✅ | 8–20 band |
| **recurReminder1** | ❌ **none** | fires hourly for every client |
| **slaMonitor1** | ❌ **none** | fires hourly for every client |
| stageTrans01ghl | ✅ | 6, Mon |
| weekly000001ghl | ✅ | 19, Sun |

Contrary to the initial assumption that everything ran on Asia time, six of ten workflows already gate on each client's own `timezone`. The real gaps are that **three workflows have no gate at all**, and that **target hours are hard-coded** so no client can choose when they're briefed.

The gate becomes parameterised, reading `delivery_hour` from `v_clients` with a per-workflow fallback constant:

```js
var __it = $json;
var __tz = __it.timezone || 'America/New_York';
var __dh = (__it.delivery_hour != null && __it.delivery_hour !== '')
           ? Number(__it.delivery_hour) : null;
var __target = (__dh != null && __dh >= 0 && __dh <= 23) ? __dh : FALLBACK_HOUR;
var __now;
try { __now = new Date(new Date().toLocaleString('en-US', { timeZone: __tz })); }
catch (e) { __now = new Date(); }
if (__now.getHours() !== __target) { return []; }
```

Fallbacks: briefFallback1 `7`, morningCheckin1 `6`, stageTrans01ghl `6`+Mon, nudge `12`, recur `9`, sla `8`.

**End-of-day and weekly workflows need an explicit rule, not `(dh + 12) % 24`.** A modulo wrap means a client who chose `delivery_hour = 18` would receive their "end of day" score at 06:00 the following morning — technically 12 hours later, obviously wrong. The rule is therefore:

```js
// EoD / weekly target hour
var __eod = (__dh != null && __dh >= 0 && __dh <= 11) ? (__dh + 12) : 19;
```

A morning `delivery_hour` (0–11) yields an evening EoD 12 hours later: 6am → 6pm, 8am → 8pm. Anything outside the morning range falls back to 19:00 local rather than wrapping past midnight. This keeps EoD in the evening for every possible input.

`Date.toLocaleString` with an IANA zone handles DST automatically.

**Semantics:** a client with `delivery_hour = 7` is briefed at 07:00 *their* local time — 07:00 Lagos for Dwayne, 07:00 New York for Bhakti.

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Stale backlog fires catch-up SMS.** 6 days of open `pending_replies`; briefFallback1 expires them and slaMonitor1 raises SLA breaches. Restoring service with that backlog could blast real clients with messages about last week. | 🔴 High | Import all `pending_replies` with `status='expired'`. History preserved, nothing re-fires. |
| `ghlInboundV1` matcher may not map to the Supabase node | 🟠 Med | Fall back to a Postgres node or RPC for that query only. Not on the Phase 1 critical path. |
| Airtable-only legacy client with no `profiles` row | 🟡 Low | `phone_override` / `timezone_override` + `coalesce` in `v_clients`. |
| CSV type drift (Airtable text → Postgres date/bool) | 🟡 Low | Import to staging columns, cast explicitly, verify counts before cutover. |
| `UTC` placeholder timezones | 🟠 Med | Not a migration bug but will misdeliver. Correct per client before enabling all 11. |
| Credentials exposed during debugging | 🟠 Med | Twilio token, NewsData key, Supabase service key and n8n API key all pasted in plaintext. Rotate all four. |

## 9. Out of scope (Phases 2–3)

- `daily_scores`, `biometrics`, `nudges`, `business_health`, `dead_letter`, `market_signals`, `inbound_seen`, `war_room_sessions`, `leads`, `feedback`, `monthly_reports`
- Repointing `/api/coaching`, `/api/diagnostic`, `/api/profile-sync`
- Re-enabling `Twilio Status Callback` and `Monthly Report` (both inactive)
- Rebuilding the DLQ handler on Supabase (archived Jul 29 — it was amplifying the outage)
- n8n SMTP, so password recovery doesn't require DB access
- Per-client day-of-week control and quiet hours

## 10. Files touched

- `build/migration/001_schema_phase1.sql` — schema, views, RLS, roster seed
- `build/migration/*.csv` — Airtable exports
- `build/n8n/_snapshot_pre_supabase_20260729/*.json` — rollback point (18 workflows)
- n8n workflows `morningCheckin1`, `briefBuilder1`, `briefFallback1` — Phase 1 conversions
