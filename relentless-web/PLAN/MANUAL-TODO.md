# MANUAL TODO — only the things Claude CANNOT do for you

> Everything else is built. These are the actions that require *your* logged-in browser, your
> database admin access, or your external accounts — I physically can't do them.
> (Updated 2026-06-10: Airtable write scope ✅, GHL token ✅, Google provider ✅ already done.)

---

## 🔴 Quick ones (unlock features that are already built)

### 1. Prove W1 — your profile drives the real SMS  *(2 min, your browser)*
Why me-only: the write must come from *your* authenticated session (and the safety system blocks me
from editing your live client record directly).
1. Open **http://localhost:3003/dashboard** → click **Profile** (top nav).
2. Change **"Your #1 priority right now"** to something obvious (e.g. `Launch the web app`).
3. Click **Save changes →**.
4. Tell me "saved" — I'll read Airtable back and confirm `top_priority_1` changed. ✅ then W1 is done.

### 2. Enable W2 — web tasks → Execution score  *(15 sec, Supabase SQL)*
Why me-only: creating/altering DB tables needs the admin key; I only hold the public one.
1. Supabase → **SQL Editor** → **+ New query** → paste → **Run**:
   ```sql
   alter table public.tasks add column if not exists ghl_task_id text;
   ```
2. Reload the dashboard. Add/check/delete a task → it now mirrors to GoHighLevel automatically.
   (Full steps: [../WEB-06-tasks-ghl.md](../WEB-06-tasks-ghl.md).)

### 3. Confirm Google login works  *(30 sec, your browser)* — optional
The provider is already enabled. Just verify the round-trip:
1. Sign out → on the login screen click **Continue with Google** → pick your account.
2. You should land on consent/onboarding/dashboard. Tell me if anything errors.

---

## 🟡 Later (deferred by you — do when ready)

### 4. Deploy to Vercel  *(your GitHub + Vercel accounts)*
Full guide: [05-deploy-vercel.md](05-deploy-vercel.md). You create/authorize the accounts, paste
~5 env vars I give you, and add the live URL to Supabase redirect settings. I prep + guide everything.

### 5. Second client (multi-tenant)  *(only when you onboard client #2)*
Full guide: [03-multi-client-mapping.md](03-multi-client-mapping.md). A Supabase SQL block (I give it)
+ duplicating the Airtable template base in the UI (no API for that).

---

## ✅ Done / built by me (not on your list)
- App, auth, route protection, consent, profile/onboarding, tasks, meetings — **live**
- Dashboard shows **real** score/recovery/briefing/trend from your backend — **live**
- **W1** profile-write route + Profile-edit screen — **built** (needs step 1 to verify)
- **W2** tasks→GHL route + dashboard wiring — **built** (needs step 2 to activate)
- **P1** polish: edit-task (rename + click-to-change priority), error boundary, mobile layout,
  API auth guard + 60s caching — **built**
- **A1** Google provider — **enabled** (needs step 3 to verify)

### Fastest path
Do **step 1** (2 min) → I confirm W1. Run **step 2's SQL** → W2 goes live. That's the whole
write-path done with ~3 minutes of your time.
