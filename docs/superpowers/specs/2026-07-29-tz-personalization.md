# Per-Client Timezone Personalization

**Date:** 2026-07-29
**Author:** Claude (brainstorming → spec)
**Status:** SUPERSEDED by `2026-07-29-airtable-to-supabase-migration-design.md` (§7).

> This spec assumed Airtable remained the data layer. Airtable's API billing
> quota is exhausted and the data layer is migrating to Supabase, so the
> timezone work is folded into that migration instead. Retained for the gate
> audit in §1, which is still accurate.
**Scope:** All 10 active hourly workflows + 3 ungated workflows on the Hetzner n8n instance

---

## 1. Problem Statement

User observation: "the briefings should be delivered per client's timezone, not Asia."

### What I actually found (audit results)

I read every active workflow on the Hetzner n8n instance (`https://167.233.94.171.nip.io`). The state is:

| Workflow | TZ gate? | Target hour | Notes |
|---|---|---|---|
| briefBuilder1 (mood-adapted) | None | — | Triggered by webhook, not scheduled. TZ is irrelevant. |
| briefFallback1 (7AM no-reply) | ✅ | 7 | Hard-coded |
| eodPro00001ghl (EoD PRO) | ✅ | 19 | Hard-coded |
| market000001 (Market Intel) | ✅ | 5 | Global, not client-specific (external news API) — leave alone |
| morningCheckin1 | ✅ | 6 | Hard-coded |
| nudgeEngineGhl1 | ❌ | — | **No gate — runs every hour** |
| onboard00001ghl | ✅ | 8..20 (window) | Waking-hours band — correct |
| recurReminder1 | ❌ | — | **No gate — runs every hour** |
| slaMonitor1 | ❌ | — | **No gate — runs every hour** |
| stageTrans01ghl | ✅ | 6 (Mon only) | Hard-coded |
| weekly000001ghl | ✅ | 19 (Sun only) | Hard-coded |

**The infrastructure for per-client TZ already exists.** Every TZ-gated workflow reads `client.timezone` (IANA format) from `tbl_client_profile`, falls back to `America/New_York` for legacy records, computes the client's *local* hour, and only fires when that hour equals the workflow's target. The dashboard already collects the timezone at onboarding (`TimezoneSelect.tsx`), validates it server-side (`provision/route.ts`), and writes it to Airtable.

**The real problems are two:**

1. **3 workflows have no TZ gate at all** (nudge, recur, SLA) — they spam every client every hour regardless of local time.
2. **Target hours are hard-coded** — a Nigerian client can't say "send my briefing at 6am my time instead of 7am".

The user has chosen:
- **Per-client override with sane defaults** — each client can override the default per workflow.
- **One shared `delivery_hour` column on `tbl_client_profile`** — controls all workflows; per-workflow sensible fallback if the field is absent.

---

## 2. Design

### 2.1 New column on `tbl_client_profile`

| Field | Type | Notes |
|---|---|---|
| `delivery_hour` | number (0–23) | Local hour-of-day. **All** client-controlled workflows respect this. |

Validation: server-side (`isValidTimezone` already exists in `relentless-web/src/lib/timezones.ts`). The web app's onboarding/profile-edit form must reject out-of-range values and silently apply the client's detected browser TZ if blank (today's behavior, unchanged).

### 2.2 Workflow behaviour matrix

| Workflow | Local target hour | Day-of-week filter | Behaviour if `delivery_hour` set |
|---|---|---|---|
| briefFallback1 | `delivery_hour ?? 7` | none | skip client if local hour ≠ target |
| morningCheckin1 | `delivery_hour ?? 6` | none | skip if hour ≠ target |
| eodPro00001ghl | `(delivery_hour + 12) % 24 ?? 19` | none | morning-H + 12h; falls back to 7pm if no override |
| weekly000001ghl | `(delivery_hour + 12) % 24 ?? 19` | **Sun only** | skip if DOW ≠ 0 |
| stageTrans01ghl | `delivery_hour ?? 6` | **Mon only** | skip if DOW ≠ 1 |
| market000001 | n/a (global) | n/a | unchanged — pulls global news feed |
| onboard00001ghl | n/a (band) | n/a | unchanged — 8..20 local window |
| nudgeEngineGhl1 | `delivery_hour ?? 12` | none | **NEW: add TZ_GATE** |
| recurReminder1 | `delivery_hour ?? 9` | none | **NEW: add TZ_GATE** |
| slaMonitor1 | `delivery_hour ?? 8` | none | **NEW: add TZ_GATE** |

Rationale: briefing in the morning, EoD/weekly 12h later (so an 8am briefing → 8pm EoD, a 6am briefing → 6pm EoD). Nudges/recur/SLA land mid-day. These defaults preserve today's behavior for the 7am club while letting anyone tweak.

### 2.3 Per-client loop wrapper

Each TZ-gated workflow already uses this pattern:

```js
// === TZ GATE (top-level; returns [] to skip this client) ===
{
  var __it = $json.fields ? $json.fields : $json;
  var __tz = __it.timezone || 'America/New_York';
  var __now;
  try { __now = new Date(new Date().toLocaleString('en-US', { timeZone: __tz })); }
  catch (e) { __now = new Date(); }
  var __h = __now.getHours();
  var __target = 7;            // <-- hard-coded today
  if (__h !== __target) { return []; }
}
// === END TZ GATE ===
```

The new wrapper reads `delivery_hour` (with per-workflow fallback) and resolves the target dynamically. Same shape, parameterized:

```js
// === TZ GATE (top-level; returns [] to skip this client) ===
{
  var __it = $json.fields ? $json.fields : $json;
  var __tz = __it.timezone || 'America/New_York';
  var __dh = (__it.delivery_hour != null && __it.delivery_hour !== '')
             ? Number(__it.delivery_hour)
             : null;
  // Resolve target hour. Each workflow embeds its own constant as fallback.
  var __target = (__dh != null && __dh >= 0 && __dh <= 23) ? __dh : FALLBACK_HOUR;
  // EoD-style workflows can also derive: var __target = (__dh != null) ? (__dh + 12) % 24 : 19;
  var __now;
  try { __now = new Date(new Date().toLocaleString('en-US', { timeZone: __tz })); }
  catch (e) { __now = new Date(); }
  var __h = __now.getHours();
  if (__h !== __target) { return []; }
  // Optional DOW check (weekly, stageTrans): var __dow = __now.getDay(); if (__dow !== N) return [];
}
// === END TZ GATE ===
```

**The fallback constant is embedded into the workflow code at deploy time** (not into the client's profile). This keeps the column count to 1 even though each workflow has its own default.

### 2.4 Data flow

1. **Onboarding / profile-edit** → `provision/route.ts` writes `timezone` (IANA) and `delivery_hour` (number) to `tbl_client_profile`.
2. **Each workflow** fetches the client profile (already does — `loadProfile` / `Search records` node).
3. **TZ_GATE node** reads `timezone` + `delivery_hour`, computes local hour, decides skip vs continue.
4. **Airtable field `delivery_hour`** is the single source of truth — no separate cache.

### 2.5 Edge cases handled

- **DST transitions**: `Date.toLocaleString('en-US', { timeZone })` handles IANA DST automatically. No code change needed.
- **Late-night delivery_hour (e.g. 23)**: legitimate. Falls back gracefully — if 23 != local hour at trigger time, skip until next hour.
- **Multiple clients in same trigger**: each is gated independently. No race.
- **Airtable returns `delivery_hour` as string** ("8" vs 8): wrapper coerces via `Number()`; non-numeric → fallback.
- **Missing client record**: workflows already handle (skip via empty result set).

### 2.6 Edge cases NOT handled (out of scope)

- Per-client **day-of-week** control (e.g. "weekly on Tuesday not Sunday"). Future.
- Per-client **quiet hours** ("don't message between 10pm and 7am"). Future.
- Per-client **message-channel** preference (SMS vs WhatsApp vs email). Already partly handled by GHL channel split, out of scope here.

---

## 3. Implementation

### Step 1 — Airtable schema
Add `delivery_hour` (number, 0..23) to `tbl_client_profile`. Backfill all existing clients with sensible defaults based on their timezone (e.g. NY → 7, Lagos → 6).

### Step 2 — Web app
- `relentless-web/src/app/api/provision/route.ts`: accept and validate `delivery_hour`.
- `relentless-web/src/app/onboarding/page.tsx` and `dashboard/page.tsx`: add a "Default delivery time (local hour)" picker. Default to current timezone's morning hour.
- New helper `validateDeliveryHour(h)` in `lib/timezones.ts`.

### Step 3 — Workflow edits
For each of the 10 active workflows that touch clients:

| Workflow | Change |
|---|---|
| briefFallback1 | Replace `var __target = 7;` with the parameterized version, fallback 7 |
| morningCheckin1 | Same, fallback 6 |
| eodPro00001ghl | Same, target = `(delivery_hour ?? null) ? (dh + 12) % 24 : 19` |
| weekly000001ghl | Same as EoD, + DOW filter for Sun |
| stageTrans01ghl | Same as briefing, + DOW filter for Mon |
| onboard00001ghl | No change (already 8..20 band) |
| market000001 | No change (global) |
| **nudgeEngineGhl1** | **Add full TZ_GATE block** with target = delivery_hour ?? 12 |
| **recurReminder1** | **Add full TZ_GATE block** with target = delivery_hour ?? 9 |
| **slaMonitor1** | **Add full TZ_GATE block** with target = delivery_hour ?? 8 |

Each edit goes via `PATCH /rest/workflows/{id}` (the API I already exercised for the stagger fix).

### Step 4 — Test
- Backfill `client_test` with `timezone = 'America/New_York'` and `delivery_hour = 7`. Trigger morningCheckin1 manually — confirm runs.
- Backfill second row with `timezone = 'Europe/Lagos'`, `delivery_hour = 7`. Trigger again — confirm runs (Lagos is +1 from UTC).
- Backfill with `delivery_hour = 3` and trigger at 3 UTC — confirm skipped because that's not local hour 3 in either tz.
- Multi-client fanout test: two rows, different tzs, different delivery_hours — confirm only the matching client gets messaged.

### Step 5 — Rollback
Each PATCH produces a new `versionId` in n8n. Rolling back means re-PATCHing from the saved `_PATCHED.json` of the previous version. We snapshot the pre-change state of all 10 workflows before the edit, save under `D:/DIGITAL DADA/GoeCoach-Plan/build/n8n/_rollback/2026-07-29-tz-personalization/`.

---

## 4. Risk

| Risk | Severity | Mitigation |
|---|---|---|
| Airtable rate-limit (already broken at :00) | Already mitigated by stagger | Re-stagger is unaffected by this change |
| Wrong `delivery_hour` defaults backfire | Medium | Fallback constants are conservative (7/6/19). Run for 48h before opening to clients. |
| n8n `__it.delivery_hour` undefined for existing rows | Low | Wrapper falls back to constant — already handles this |
| DST skips an hour | Low | At trigger minute 0, an hour may "not exist" (spring forward) or "exist twice" (fall back). Workflow only fires once per cron, so worst case = brief 1h delay. Acceptable. |

---

## 5. Out of Scope (future specs)

- Per-client DOW filter
- Per-client quiet hours
- Real-time channel routing (SMS vs WhatsApp) per client
- DST-aware per-window scheduling (instead of "fire at hour X")

---

## 6. Files Touched

- `relentless-web/src/lib/timezones.ts` — add `validateDeliveryHour`
- `relentless-web/src/app/api/provision/route.ts` — accept `delivery_hour`
- `relentless-web/src/app/onboarding/page.tsx` — add picker
- `relentless-web/src/app/dashboard/page.tsx` — show current value
- `build/n8n/_rollback/2026-07-29-tz-personalization/*.json` — workflow snapshots
- 10 n8n workflows on the Hetzner instance — TZ_GATE parameterization

No new infrastructure, no new tables, no schema migrations beyond the one column.
