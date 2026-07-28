# WEB-03 — Create the `meetings` table in Supabase (one-time, ~1 min)

Makes Meetings real and per-user (survives reloads), just like your tasks.
Copy → paste → Run. Once only.

## Steps

1. **https://supabase.com** → sign in → open your **relentless-ai** project.
2. Left sidebar → **SQL Editor** → **+ New query**.
3. Clear the editor, **paste the whole block below**, click **Run** (or Ctrl + Enter).
4. Expect **“Success. No rows returned.”** ✅

## Paste this exactly

```sql
-- Relentless AI: per-user meetings table + security rules
create table if not exists public.meetings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  meet_time  text,                       -- legacy fallback; new rows store the ISO timestamp here too
  scheduled_at timestamptz,              -- exact date/time for SMS reminders
  google_event_id text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Safe for existing installs: `create table if not exists` does not add columns later.
alter table public.meetings
  add column if not exists scheduled_at timestamptz,
  add column if not exists google_event_id text,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists meetings_user_id_idx on public.meetings (user_id);
create index if not exists meetings_scheduled_at_idx on public.meetings (user_id, scheduled_at);
create index if not exists meetings_reminder_lookup on public.meetings (scheduled_at) where reminder_sent_at is null;

alter table public.meetings enable row level security;

drop policy if exists "meetings_select_own" on public.meetings;
drop policy if exists "meetings_insert_own" on public.meetings;
drop policy if exists "meetings_update_own" on public.meetings;
drop policy if exists "meetings_delete_own" on public.meetings;

create policy "meetings_select_own" on public.meetings
  for select using (auth.uid() = user_id);
create policy "meetings_insert_own" on public.meetings
  for insert with check (auth.uid() = user_id);
create policy "meetings_update_own" on public.meetings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meetings_delete_own" on public.meetings
  for delete using (auth.uid() = user_id);
```

## After it runs
- Reload **http://localhost:3003/dashboard**.
- Meetings now load from the database with date + time.
- Add a meeting (title + date + time), or delete one with the **×** — then reload; it sticks. 🎉
