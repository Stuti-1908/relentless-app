# WEB-06 — One SQL line so web tasks link to GoHighLevel (W2)

Adds a column that stores each web task's GHL task id, so completing a task in the app updates the
real Execution score. ~15 seconds.

## Steps
1. **https://supabase.com** → your **relentless-ai** project → **SQL Editor** → **+ New query**.
2. Paste this, click **Run** → expect **“Success. No rows returned.”** ✅

```sql
-- WEB-06: link web tasks to their GoHighLevel task (for the Execution score)
alter table public.tasks add column if not exists ghl_task_id text;
```

## After it runs
- Reload **http://localhost:3003/dashboard**.
- **Add a task** in the app → it's created as a GHL task on your contact automatically.
- **Check it off** → the GHL task is marked complete.
- **Delete it** → the GHL task is removed.
- Run your **End-of-Day Score** workflow in n8n → the **Execution pillar** now reflects your
  web tasks (instead of the placeholder 70).

> Until you run this line, tasks still work normally in the app — they just won't sync to GHL yet
> (the app degrades gracefully). Tip: name a task like one of your top priorities so the Execution
> score matches it.
