# Phase W3 — Multi-client mapping (beyond the single test client)

> **Goal:** today the app is hardwired to ONE Airtable base (the test client). To serve real,
> multiple clients, each logged-in user must map to **their own** client record + Airtable base +
> GHL contact. This is what makes Relentless AI a real multi-tenant managed service.

**Status:** ⬜ not started · **Effort:** L (2–3 sessions) · **Depends on:** W1 (profile write), ideally W2

> ⚠️ **Only needed when you onboard a SECOND real client.** For demos/the first client, the
> single-base setup is fine. Don't build this early.

---

## The model (matches the master spec's isolation design)
- One **TEMPLATE** Airtable base (`Relentless AI TEMPLATE`) is **cloned once per client**.
- The **OPS** base's `tbl_clients_registry` is the routing table: `client_id → airtable_base_id`,
  `ghl_contact_id`, `plan`, `timezone`, `active`.
- Every workflow already filters by `client_id` and reads that client's base.

The web app must learn the **same routing**: logged-in Supabase user → `client_id` → base/contact.

---

## 🤖 I build
1. **Extend Supabase `profiles`** (SQL `WEB-07`): add `client_id`, `airtable_base_id`,
   `ghl_contact_id`, `plan` (default `standard`). RLS unchanged (own-row).
2. **Make `/api/coaching` per-user:** read the caller's Supabase session → look up their
   `airtable_base_id`/`client_id` → read THAT base (not the env-pinned one). Same for profile-sync /
   tasks-sync. The env `AIRTABLE_BASE_ID` becomes a fallback only.
3. **Provisioning flow** (pick one with you):
   - **Manual (simplest first):** an Admin View (P1/F1) where you create a client = clone base +
     add a registry row + set the user's `client_id`. I provide a script/route to clone the template
     base (Airtable has no native "duplicate base" API → use a create-tables + copy approach, or
     document the manual duplicate-in-UI step + register).
   - **Self-serve (later):** onboarding auto-provisions on first login.
4. **Registry write:** when a client is created, write `tbl_clients_registry` (OPS base) so n8n's
   scheduler picks them up (`active=true`, timezone, plan).
5. **Security hardening:** the OPS base + registry is the only cross-tenant surface — use a separate,
   tightly-scoped token; never expose base ids to the browser.

---

## 👤 You decide
- **Provisioning model:** manual admin (recommended to start) vs self-serve onboarding.
- **Base cloning:** are you OK duplicating the template base in the Airtable UI per client (1 click),
  with the app just registering it? (Simplest, reliable.) Or do you want fully automated cloning?

---

## ✅ Verification
1. Create a 2nd test user in the app → assign them a 2nd client base.
2. Log in as user A → see client A's scores. Log in as user B → see client B's scores. **No leakage.**
3. Confirm n8n scheduler now lists both clients (registry `active=true`).

---

## Risks / gotchas
- **No Airtable "duplicate base" API** — cloning is the hard part; manual-duplicate + register is the
  pragmatic path. Document it as a runbook.
- **Cross-tenant safety:** a bug here could show one client another's data. RLS on Supabase protects
  the web tables, but Airtable reads are gated only by the server route's lookup — write tests for it.
- **Registry consistency:** web and n8n must agree on `client_id` and `airtable_base_id`.

---

## Deliverables
- `WEB-07-profile-client-routing.md` (SQL + steps)
- per-user routing in all `/api/*` routes
- a provisioning runbook (clone + register)
- cross-tenant isolation test notes
- HANDOFF.md updated
