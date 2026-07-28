# WEB-01 — Create the `tasks` table in Supabase (one-time, ~2 min)

This gives every logged-in user their own private to-do list that survives reloads.
You only do this **once**. Just copy → paste → run.

## Steps (click-by-click)

1. Go to **https://supabase.com** and sign in.
2. Open your project **relentless-ai** (URL: `iqdkoufpiafbhmicbdsy`).
3. In the **left sidebar**, click **SQL Editor** (icon looks like `</>` / "SQL").
4. Click the green **+ New query** button (top area).
5. **Delete anything** in the editor, then **paste the whole block below**.
6. Click the green **Run** button (bottom-right), or press **Ctrl + Enter**.
7. You should see **“Success. No rows returned.”** — that's it. ✅

## Paste this exactly

```sql
-- Relentless AI: per-user tasks table + security rules
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  priority   text not null default 'med' check (priority in ('high','med','low')),
  meta       text default 'Due today',
  due_date   date,
  ghl_task_id text,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

-- Safe for existing installs: `create table if not exists` does not add columns later.
alter table public.tasks
  add column if not exists due_date date,
  add column if not exists ghl_task_id text;

-- Helps the app load each user's tasks quickly.
create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tasks_due_date_idx on public.tasks (user_id, due_date);

-- Row Level Security: every user can see/edit ONLY their own tasks.
alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;

create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert with check (auth.uid() = user_id);
create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() = user_id);
```

## After it runs
- Go back to the app at **http://localhost:3003/dashboard** and **reload**.
- Your to-do list now loads from Supabase. Tick a box, add a task, or delete one (the **×**),
  then **reload** — your changes stick. 🎉
- First login seeds 5 example tasks so the list isn't empty; delete them anytime.

> Security note: **Row Level Security** is ON, so even though the app uses a public key,
> the database itself blocks anyone from reading another user's tasks.
