# WEB-07 — Add task dates + meeting reminder timestamps

Run this once in Supabase if your `tasks` and `meetings` tables already exist.

```sql
alter table public.tasks
  add column if not exists due_date date,
  add column if not exists ghl_task_id text;

alter table public.meetings
  add column if not exists scheduled_at timestamptz,
  add column if not exists google_event_id text,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists tasks_due_date_idx
  on public.tasks (user_id, due_date);

create index if not exists meetings_scheduled_at_idx
  on public.meetings (user_id, scheduled_at);

create index if not exists meetings_reminder_lookup
  on public.meetings (scheduled_at)
  where reminder_sent_at is null;
```

After it runs, the dashboard can save task due dates, meeting dates, and the SMS workflow can remind 5 minutes before a meeting on any date.
