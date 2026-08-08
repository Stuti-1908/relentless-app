# Fix Plan — inbound replies + client roster

**Written:** 2026-08-08, from live checks (not memory).
**Owner split:** P0 is yours (GHL dashboard). P1–P3 I can do once you confirm.

---

## The one-line summary

Outbound is healthy — **448 executions, 448 successes, 0 errors**, and all 6
SMS-capable clients got 4 morning check-ins each. **Inbound is completely silent:
GHL is not calling the n8n webhook.** Until that is fixed, no reply can ever be
parsed, so no biometrics are written and no score can be computed. Everything
else on this page is secondary.

---

## Evidence

| Check | Result | Means |
|---|---|---|
| n8n executions since deploy | 448 success, 0 error | pipeline healthy |
| Morning sends since Aug 5 | 27, evenly 4 per client | outbound + timezones correct |
| `ghlInboundV1` executions in 2 days | **2** (my test + one old error) | **no real inbound has arrived** |
| `pending_replies` with `status='matched'` | **0** | no reply ever parsed |
| `biometrics` rows | **0** | nothing to score |
| `daily_scores` | 4 rows, all `composite_score: null`, `biometric_missing: true` | scores can't compute |
| `POST /webhook/ghl-inbound` | `200 {"ok":true}` | **n8n is ready and listening** |
| `POST /webhook/does-not-exist` | `404` | routing is real, not a catch-all |

The last two rows together are the proof: the endpoint is genuinely registered
and returns a clean response even for an unknown contact. n8n is not the problem.

---

## P0 — Point GHL's inbound webhook at n8n 🔴 BLOCKING (yours, ~5 min)

Nothing else matters until this is done. This is a GoHighLevel **configuration**
change — there is no code to write.

### Steps

1. Log in to **GoHighLevel** → the Relentless sub-account/location.
2. Go to **Settings → Integrations → Webhooks**
   (some plans expose this as **Automation → Workflows → trigger: "Customer Replied"**).
3. Create or edit the inbound-message webhook with:
   - **URL:** `https://167.233.94.171.nip.io/webhook/ghl-inbound`
   - **Method:** `POST`
   - **Event / Trigger:** inbound message received (SMS)
4. Save, then **send a real SMS reply** from a phone that is one of the clients
   below, replying to a morning check-in with three numbers, e.g. `4 3 2`.

### If GHL has no direct webhook option

Use a Workflow instead: **Trigger** = "Customer Replied" (channel: SMS) →
**Action** = "Webhook" / "Custom Webhook" → POST to the URL above.

### How we confirm it worked

Tell me once it's saved and I will verify from the live system:
- `ghlInboundV1` execution count goes above 2 and the newest is `success`
- the matching `pending_replies` row flips `open` → `matched`
- a `biometrics` row appears with the parsed sleep / energy / stress
- that evening, `daily_scores` gets a row with a **non-null** `composite_score`

**Success = a client replies and a real score appears the same evening.**

### Note on the URL

`167.233.94.171.nip.io` resolves to the server's raw IP via nip.io. It works and
is TLS-terminated, but it is not a durable production hostname — if the server IP
ever changes, every webhook silently breaks. Worth moving to a real subdomain
later; **do not change it as part of this fix**, since that would alter two things
at once and make a failure ambiguous.

---

## P1 — Decide what to do with the 5 non-client rows (yours: a decision)

The roster has 11 rows but only **6 can receive SMS**. The other 5 look like test
or duplicate records — three are literally the same person and phone as you.

| client_id | Name | Phone | Issue |
|---|---|---|---|
| `client_73bed63e` | Stuti Gohil | +916355046464 | no `ghl_contact_id` |
| `client_24397b6b` | Digital Dada | 03312324272 | no `ghl_contact_id`, phone not E.164 |
| `client_720b9768` | Stuti Gohil | +916355046464 | no `ghl_contact_id`, `timezone=UTC` |
| `client_0bf09430` | Stuti Gohil | +91 6355046464 | no `ghl_contact_id`, `timezone=UTC` |
| `client_test` | Stuti Gohil | +916355046464 | real GHL id — **keep**, it is the test client |

Consequence today: the SLA monitor correctly flags these every morning as
"morning send missing", which is what filled `dead_letter` with 10 rows. Those
rows are the system working, not failing — but the alerts are noise.

**I need your decision before touching any of them.** Options, per row:
- **Deactivate** (`active=false`) — stops the SLA noise, keeps history. Recommended
  for the 4 duplicates/tests.
- **Provision a GHL contact** — if any is a real person who should get SMS.
- **Delete** — only if you are certain it is junk. Irreversible.

I will not deactivate or delete a client record on my own judgement.

---

## P2 — Fix placeholder timezones (mine, once you confirm the zones)

`UTC` is not a location. A client on `UTC` gets briefed at UTC-morning, not their
own 6 AM.

| client_id | Name | Current | Likely correct | Confirm? |
|---|---|---|---|---|
| `client_d2232ae2` | Oyaide Joshua Silver | `UTC` | `Africa/Lagos` (phone +234 = Nigeria) | ← **needs your OK** |
| `client_720b9768` | Stuti Gohil | `UTC` | — | moot if deactivated in P1 |
| `client_0bf09430` | Stuti Gohil | `UTC` | — | moot if deactivated in P1 |
| `client_test` | test client | `Asia/Calcutta` | fine for testing | leave |

Oyaide is the only **real** client affected. His +234 number implies Nigeria, but
a phone prefix is not proof of residence — **please confirm before I change it.**

Also worth noting: `client_ae94411e` (Luke) has a +234 number but is set to
`America/New_York`. That may well be correct — people travel and relocate — but it
is worth a glance while you are checking Oyaide.

---

## P3 — Exercise War Room (mine, after P0 is green)

`warRoom0001` is webhook-triggered and has **never fired** since the migration, so
its new client-lookup logic is untested against real traffic.

Background: it used to match on phone number alone, which once misidentified a
paying Pro client as non-Pro because GHL formats numbers inconsistently. The
migration replaced that with the `v_clients_match` view, which exposes each client
by raw phone, **digits-only** phone, and GHL contact id.

What I will verify:
- the lookup resolves a Pro client correctly
- a Pro client is **not** told "this is a Pro feature"
- a row lands in `war_room_sessions` keyed on `session_id`
- the upsert converges on **one** row across multiple turns

One caveat: every client currently shows `plan = standard`, including
`client_test`. So War Room will refuse everyone as non-Pro right now. To test it
properly, one client needs `plan = pro` — tell me which and I will set it, or set
it yourself in Supabase.

---

## Order of execution, and why

```
P0  GHL webhook            ← BLOCKING. Nothing downstream can work without it.
 │
 ├─ P1  roster decision    ← needs your call; also silences the SLA alerts
 ├─ P2  timezones          ← needs your confirmation of Oyaide's location
 └─ P3  War Room           ← only meaningful once inbound works + a client is Pro
```

P1 and P2 are independent of P0 and can happen in parallel, but both are blocked
on **your** decisions, not on work.

---

## What is explicitly NOT broken

Worth stating plainly, so effort does not get spent here:

- The Airtable → Supabase migration. 448/448 executions, zero Airtable nodes left.
- Outbound SMS. 27 morning sends, 77 nudges, all delivering.
- Per-client timezones. Dwayne received his check-in at 05:50 UTC = **06:50 Lagos**,
  his correct local 6 AM.
- The brand logo / PWA icons. Live and verified in production.
- The 10 `dead_letter` rows. That is the SLA monitor doing its job, correctly
  flagging clients who cannot receive SMS. They will stop once P1 is resolved.
