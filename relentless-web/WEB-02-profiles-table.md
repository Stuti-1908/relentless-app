# WEB-02 — Create the `profiles` table in Supabase (one-time, ~1 min)

This stores each user's name, mobile number, company/role, timezone, and top priority —
so the app greets them by name and (later) the SMS backend knows where to text.
Same as before: copy → paste → Run. You only do this **once**.

## Steps

1. **https://supabase.com** → sign in → open your **relentless-ai** project.
2. Left sidebar → **SQL Editor** → **+ New query**.
3. Clear the editor, **paste the whole block below**, click **Run** (or Ctrl + Enter).
4. Expect **“Success. No rows returned.”** ✅

## Paste this exactly

```sql
-- Relentless AI: per-user profile + security rules
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  company      text,
  role         text,
  phone        text,
  timezone     text default 'America/New_York',
  primary_goal text,
  onboarded    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
```

## After it runs
- The onboarding screen now shows a **form** under the "how it works" steps.
- Fill in your name + mobile (required), company/role/timezone/priority (optional) →
  **Save & go to my dashboard**.
- The dashboard greeting becomes **"Good morning, &lt;your name&gt;"**.
- Reload anytime — your profile is remembered, and you won't be asked to onboard again.

> Security: **Row Level Security** is ON — each user can read/write only their own profile row.
