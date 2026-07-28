# Phase W2 — Write path: Tasks → GHL (feed Execution score + nudges)

> **Goal:** the to-dos you add in the web app become the tasks the SMS service tracks — so completing
> them in the app moves your **Execution pillar** and gives the **nudge engine** something real to chase.

**Status:** ⬜ not started · **Effort:** M–L · **Depends on:** W1 (client mapping), tasks feature (#5)

---

## Why this matters
The backend's **Execution** pillar is computed from **GoHighLevel (GHL) tasks**
(`build/harness/scoring/executionFromGhlTasks.js`: matched priorities ×33.3 + extra-task bonus).
Today those GHL tasks are created by hand. After W2, your web to-dos sync to GHL, so the Execution
score reflects what you actually do in the app — and nudges can reference open items.

---

## Design decision (I'll recommend, you confirm)
**Where do web tasks live so the backend sees them?** Two options:

- **Option A — Sync web tasks → GHL contact tasks** *(recommended)*: matches the existing Execution
  logic with zero n8n changes. Web `tasks` table stays the source of truth for the UI; a sync pushes
  create/complete/delete to the GHL contact (`v8lIYQuHTAcLFmbJ0HUt` for the test client).
- **Option B — Mirror to an Airtable `tbl_tasks`** and change the Execution module to read Airtable.
  More work (touches tested n8n code) and duplicates GHL. Only if GHL tasks prove too limited.

We go with **A** unless GHL's task API blocks us.

---

## 👤 You do
- Confirm we can use the existing GHL test contact for now (yes, unless you want a different one).
- Later (W3 / real clients): each web user maps to their own GHL contact id.

---

## 🤖 I build
1. **Server route `POST /api/tasks-sync`** using the n8n GHL integration's API style:
   host `services.leadconnectorhq.com`, header `Version: 2021-07-28`, Bearer PIT token.
   - **Secret:** I'll need the GHL PIT token available to the web app as a server-only env var
     `GHL_TOKEN` (+ `GHL_LOCATION_ID=HlI90j86nBEuhp9Oovf9`, `GHL_CONTACT_ID`). (👤 you paste the PIT
     token — same one n8n uses, or a fresh Private Integration token.)
2. **Hook task events** in the dashboard:
   - add task → create GHL task (store the returned `ghl_task_id` on the Supabase row).
   - check/uncheck → mark GHL task complete/incomplete.
   - delete → delete the GHL task.
   - Add a `ghl_task_id` column to the Supabase `tasks` table (one small SQL: `WEB-06`).
3. **Resilience:** sync failures don't block the UI; a tiny "synced ✓ / retry" indicator per task.
   Idempotent: never double-create.

---

## ✅ Verification
1. Add a task in the web app → confirm it appears as a GHL task on the contact (I read it back via API).
2. Check it off → GHL task shows completed.
3. **Run the End-of-Day Score workflow in n8n** → confirm the **Execution pillar** changed from the
   placeholder 70 to a value derived from your completed tasks → visible on the dashboard's pillar list.
4. Delete a task → GHL task gone.

---

## Risks / gotchas
- **GHL task API shape:** confirm the create/update/complete endpoints + required fields (title, dueDate,
  completed). I'll verify against a live GET first.
- **Matching to priorities:** Execution scoring matches task *titles* to the client's top-3 priorities
  (normalized contains-match). So titles matter — wording your tasks like your priorities scores higher.
  I'll surface this subtly in the UI later.
- **Token scope:** the PIT token needs `contacts.write` + tasks scope. If tasks aren't covered, fall back
  to Option B.

---

## Deliverables
- `src/app/api/tasks-sync/route.ts`
- dashboard task handlers call it; `ghl_task_id` stored
- `WEB-06-tasks-ghl.md` (SQL for `ghl_task_id` column + test steps)
- `.env.local`: `GHL_TOKEN`, `GHL_LOCATION_ID`, `GHL_CONTACT_ID`
- HANDOFF.md updated
