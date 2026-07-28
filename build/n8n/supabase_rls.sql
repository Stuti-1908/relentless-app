-- Relentless AI — Supabase RLS (Row Level Security) policies
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- What it does: locks every table so a signed-in user can ONLY see/edit their OWN rows.
-- Without this, any authenticated user could read every other user's tasks and profile.

-- ── 1. profiles ──────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Users can read their own profile only.
create policy "profiles: own row read"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile only.
create policy "profiles: own row update"
  on public.profiles for update
  using (auth.uid() = id);

-- ── 2. tasks ─────────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;

create policy "tasks: own rows read"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "tasks: own rows insert"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "tasks: own rows update"
  on public.tasks for update
  using (auth.uid() = user_id);

create policy "tasks: own rows delete"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- ── 3. meetings ───────────────────────────────────────────────────────────────
-- Only add this block if a meetings table exists in your Supabase project.
alter table public.meetings enable row level security;

create policy "meetings: own rows read"
  on public.meetings for select
  using (auth.uid() = user_id);

create policy "meetings: own rows insert"
  on public.meetings for insert
  with check (auth.uid() = user_id);

create policy "meetings: own rows update"
  on public.meetings for update
  using (auth.uid() = user_id);

create policy "meetings: own rows delete"
  on public.meetings for delete
  using (auth.uid() = user_id);

-- ── Verification query (run after the above) ─────────────────────────────────
-- Paste this separately to confirm RLS is ON for all 3 tables:
--
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in ('profiles', 'tasks', 'meetings');
--
-- Expected result: rowsecurity = true for all 3 rows.
