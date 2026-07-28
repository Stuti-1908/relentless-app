# Phase 3 — GHL contact provisioning repair (analysis + diff-plan)

Source: `PLAN-GLOBAL-PRODUCTION.md` Bug 3 / Phase 3. Not built here — the main agent owns the n8n
workflow build/deploy; this file specs both halves (web route change + repair job) precisely
enough to implement without further investigation.

## 1. Current state of `relentless-web/src/app/api/provision/route.ts`

**It already does most of what Bug 3 asks — this route is not the reason 8/14 clients lack a
`ghl_contact_id`.**

- Lines 98–116: on every new signup, if `GHL_TOKEN` + `GHL_LOCATION_ID` + a valid E.164 `phone`
  are present, it `POST`s `${GHL_API}/contacts/` (`GHL_API` defaults to
  `https://services.leadconnectorhq.com`) and captures `contact.id` into `ghlContactId`.
- Line 133: `if (ghlContactId) fields.ghl_contact_id = ghlContactId;` — written into the new
  Airtable `tbl_client_profile` row at creation time (line 134-148, `POST .../tbl_client_profile`).
- Lines 168–177: `ghlContactId` is also written to Supabase `profiles.ghl_contact_id` via
  `supabase.from("profiles").update(...)`.

**But it is explicitly "best-effort" and silent on failure:**
- Line 100: the GHL call only fires `if (ghl && ghlLoc && phone)` — no error/short-circuit if any
  of those three are falsy; provisioning proceeds anyway with `ghlContactId = null`.
- Lines 107–115: if the GHL `fetch` throws, or `r.ok` is false (e.g. GHL rate limit, bad phone
  format, temporary outage), the error is only `console.error`'d — no retry, no re-queue, no
  alert. The Airtable row still gets created with `ghl_contact_id` empty (field simply omitted,
  since `fields.ghl_contact_id` is only set when `ghlContactId` is truthy).
- There's no other place in the codebase that ever revisits a client and retries the GHL contact
  creation — `profile-sync/route.ts` never touches `ghl_contact_id` at all (grep confirms; its
  field whitelist is `full_name`, `phone_number`, `timezone`, `top_priority_1` only).

**Conclusion:** the 8 empty `ghl_contact_id` rows are very likely from signups where the GHL call
failed transiently (or `GHL_TOKEN`/`GHL_LOCATION_ID` were unset/misconfigured at that time) and
nothing ever retried. The fix has two parts: (a) make failures loud/alertable instead of silent,
and (b) add a sweep job that backfills any client with a phone but no `ghl_contact_id`.

## 2. How the web app authenticates to GHL (for the n8n repair job to mirror)

Grep across `relentless-web/src` for `leadconnector`/`GHL_TOKEN` shows every GHL caller
(`api/provision/route.ts:97-116`, `api/tasks-sync/route.ts:10,20-27,46`) uses the **same pattern**:

- Base URL: `process.env.GHL_API_URL || "https://services.leadconnectorhq.com"`.
- Auth: a **static bearer token** from env var `GHL_TOKEN` (a GHL "Private Integration Token" —
  see `.env.local.example:15` `GHL_TOKEN=`, `.env.local:11` has a real `pit-...` value). This is
  NOT OAuth — it's a long-lived PIT, sent as `Authorization: Bearer ${GHL_TOKEN}`.
- Required header `Version: 2021-07-28` (contacts) — `tasks-sync` uses the same API version for
  tasks too; `provision`'s welcome-SMS call uses `Version: 2021-04-15` for
  `/conversations/messages` (different GHL sub-API, different pinned version — keep that
  distinction if the repair job ever needs to send SMS).
- `locationId` from env var `GHL_LOCATION_ID` (`.env.local.example:16` =
  `HlI90j86nBEuhp9Oovf9`) is required in the contact-create body.
- This is a **different credential space** than n8n's stored credential `fLewYZwvD9PfMAQJ` — the
  web app never touches n8n credentials; it has its own copy of the same PIT in Vercel env vars.
  **The n8n repair job should use n8n's own GHL credential (`fLewYZwvD9PfMAQJ`)**, not try to
  reuse/import the web app's env var — they're operationally separate integrations even though
  they likely point at the same GHL location. Confirm with the main agent which credential the
  n8n HTTP Request node should reference before building.

## 3a. Diff-plan — `provision/route.ts` changes

Goal: never silently drop a client without a GHL contact; make failure observable.

1. **Promote the phone-and-config check to a hard precondition with a distinct failure reason**,
   instead of only gating on `phone && ghl && ghlLoc` silently:
   ```ts
   // after computing `phone` (line 92) and before the try/catch (line 100):
   if (!ghl || !ghlLoc) {
     console.error("[provision] GHL not configured — GHL_TOKEN/GHL_LOCATION_ID missing");
   } else if (!phone) {
     console.error("[provision] no valid E.164 phone — cannot create GHL contact", { userId });
   }
   ```
   (Kept non-fatal — provisioning must still succeed so the client isn't blocked from using the
   dashboard — but now the reason is loud in server logs instead of implicit.)

2. **On GHL contact creation failure (r.ok false, or fetch throw), still write the Airtable row
   but flag it** so the repair job (3b) and any alerting can find it fast: add a field
   `ghl_provision_pending: true` (or reuse an existing status/notes field if one already exists in
   `tbl_client_profile` — check the Airtable schema before adding a new column) alongside the
   existing `fields` object built at lines 119–133. This turns a silent gap into a queryable flag
   rather than relying purely on "`ghl_contact_id` is empty" as the signal (which is also fine,
   but an explicit flag is more precise if `ghl_contact_id` could ever be legitimately blank for
   another reason).

3. **Retry once inline before giving up**, since GHL rate limits / transient 5xxs are the likely
   cause of the existing 8 gaps:
   ```ts
   async function createGhlContact(ghl: string, ghlLoc: string, fullName: string, phone: string, email: string | null) {
     for (let attempt = 0; attempt < 2; attempt++) {
       try {
         const r = await fetch(`${GHL_API}/contacts/`, {
           method: "POST",
           headers: { Authorization: `Bearer ${ghl}`, Version: "2021-07-28", "Content-Type": "application/json" },
           body: JSON.stringify({ locationId: ghlLoc, name: fullName, phone, ...(email ? { email } : {}) }),
         });
         if (r.ok) {
           const d = (await r.json()) as { contact?: { id?: string } };
           return d.contact?.id ?? null;
         }
         console.error("[provision] GHL contact failed", r.status, attempt);
       } catch (e) {
         console.error("[provision] GHL contact error", attempt, e instanceof Error ? e.message : e);
       }
       if (attempt === 0) await new Promise((res) => setTimeout(res, 500)); // brief backoff, one retry only
     }
     return null;
   }
   ```
   Replace the inline block at lines 100–116 with a call to this helper. Keep it best-effort —
   still don't block provisioning on GHL being down.

4. **Do not change the Supabase write path (lines 168–177)** — it already correctly writes
   whatever `ghlContactId` resolved to (including `null`), which is correct idempotent behavior;
   the repair job (3b) is what closes the gap for rows that landed with `null`.

This is a small, additive diff — no new abstractions, no refactor of the surrounding route.

## 3b. Design — n8n repair job `contactRepair1`

**Schedule:** every 6 hours (cron, e.g. `0 */6 * * *` UTC — matches the plan's "every 6h" cadence;
exact minute/offset to be chosen by main agent to avoid colliding with other hourly sender runs).

**Nodes (conceptual — main agent builds the actual n8n JSON):**

1. **Trigger** — Schedule Trigger, every 6h.
2. **Search records (Airtable)** — `tbl_client_profile`, filterByFormula:
   ```
   AND({active}=1, {phone_number}!='', {ghl_contact_id}='')
   ```
   This is the same "phone present, no ghl_contact_id" predicate Bug 3 names. Returns N items —
   one per client needing repair (could be 0).
3. **Mode: `runOnceForEachItem`** for every downstream Code node (per Bug 1/Phase 1 — this is a
   brand-new workflow so build it correctly from the start; don't reintroduce the run-once-for-
   all-items bug here).
4. **HTTP Request — Create GHL contact.** `POST https://services.leadconnectorhq.com/contacts/`,
   auth: n8n credential `fLewYZwvD9PfMAQJ` (confirm this is the GHL credential — Bearer/PIT
   style, same as web app's `GHL_TOKEN`), header `Version: 2021-07-28`, body:
   ```json
   { "locationId": "<GHL location id>", "name": "={{$json.full_name}}", "phone": "={{$json.phone_number}}" }
   ```
   `locationId` should come from an n8n credential/env, not hardcoded — check what
   `GHL_LOCATION_ID` equivalent n8n already uses elsewhere (other GHL-calling workflows in this
   repo, e.g. `onboard00001ghl`/`eodPro00001ghl`, likely already reference it — reuse that
   pattern instead of introducing a new one).
5. **IF node — success check.** `{{$json.contact?.id}}` exists?
   - **True branch:** Airtable **Update record** on `tbl_client_profile`, matchingColumns
     `['id']` (per the `closePending` pattern noted in Phase 0.4 of the plan — use Airtable node
     v2.2 `matchingColumns` for reliable per-row updates, not a formula-match), setting
     `ghl_contact_id = {{$json.contact.id}}`.
   - **False branch:** DLQ / alert node — same alerting mechanism the plan's Phase 5 SLA monitor
     will use (or, if that doesn't exist yet, whatever the current alert path is — grep other
     workflows for how they currently raise "RELENTLESS AI ALERT" style notices and reuse it, per
     Bug 7's fix direction of consolidating alerting). Include `client_id` and failure reason in
     the alert payload so it's actionable, not just "something failed."
6. **Idempotency / rate-limit safety:** because the trigger runs every 6h and the search filter
   re-includes any client whose previous attempt failed, a client with a persistently bad phone
   number (e.g. malformed) will retry forever and alert every 6h — that's the intended "alert
   instead of silent drop" behavior per the plan, not a bug. If repeated-alert noise becomes a
   problem, a future enhancement could add a `ghl_repair_attempts` counter field and stop
   retrying (escalate only) after N attempts — not required for the initial build.

**Gate (per plan):** 0 active clients without `ghl_contact_id` after the job has run at least
once against the current 8 gap clients.

## What the main agent / user needs to provide to execute Phase 3

1. Confirmation of which n8n credential (`fLewYZwvD9PfMAQJ` vs. another) is the correct GHL
   credential for `contactRepair1`, and where `GHL_LOCATION_ID`'s n8n-side equivalent already
   lives (check existing GHL-calling workflows for the pattern to reuse).
2. Confirm whether `tbl_client_profile` should get a new `ghl_provision_pending` field (step 2 of
   3a) or whether flagging via empty `ghl_contact_id` alone is sufficient — this affects whether
   an Airtable schema change is needed before code changes.
3. Decision on the alerting/DLQ mechanism `contactRepair1`'s failure branch should use (reuse
   existing vs. wait for Phase 5's rebuilt SLA monitor).
4. Actual deployment of both the `provision/route.ts` diff (Vercel) and the `contactRepair1`
   n8n workflow (Hetzner) — both explicitly out of scope for this analysis per the task
   constraints.
