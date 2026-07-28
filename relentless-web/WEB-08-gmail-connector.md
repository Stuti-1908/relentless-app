# WEB-08 — Gmail Connector Setup

Two parts: (1) run the SQL once in Supabase, (2) add two env vars to Vercel.

---

## Part 1 — Supabase SQL (run once in SQL Editor)

```sql
alter table public.profiles
  add column if not exists gmail_refresh_token text,
  add column if not exists gmail_connected_at timestamptz,
  add column if not exists gmail_last_sync timestamptz,
  add column if not exists gmail_unread_summary text;
```

Go to: Supabase Dashboard → SQL Editor → paste → Run.

---

## Part 2 — Google Cloud Console (reuse existing OAuth client)

The Gmail connector reuses the same Google OAuth client as Google Calendar.
You already have `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel.

The only thing you need to do is **add the Gmail scope** to your OAuth consent screen:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen
2. Click **Edit App** → Scopes → **Add or Remove Scopes**
3. Add: `https://www.googleapis.com/auth/gmail.readonly`
4. Save

Then enable the Gmail API:
1. APIs & Services → Library → search "Gmail API" → **Enable**

That's it — no new credentials needed.

---

## Part 3 — Vercel env vars

No new env vars needed. The Gmail connector reuses:
- `GOOGLE_CLIENT_ID` ✅ already set
- `GOOGLE_CLIENT_SECRET` ✅ already set

---

## How it works after setup

1. User clicks **Connect Gmail** on the Connections page
2. Google OAuth asks for `gmail.readonly` permission
3. Refresh token stored in `profiles.gmail_refresh_token`
4. Sync reads last 24h unread emails → stores summary in `profiles.gmail_unread_summary`
5. The morning briefing picks up this summary as an "Email" section

---

## Vercel redeploy

After running the SQL, redeploy:
```
vercel deploy --prod --scope dwayne-s
```
(from the `relentless-web/` folder)
