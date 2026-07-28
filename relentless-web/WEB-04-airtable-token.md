# WEB-04 — Create an Airtable token so the web app can show your REAL data

This lets the dashboard read the real briefings, scores, and recovery that your n8n/SMS
backend writes into Airtable. The token stays **server-side only** (never in the browser).
~3 minutes.

## Step 1 — Create the token

1. Go to **https://airtable.com/create/tokens** (sign in if asked).
   *(Or: airtable.com → click your avatar top-right → **Developer hub** → **Personal access tokens**.)*
2. Click **Create new token**.
3. **Name:** `Relentless Web App`
4. Under **Scopes**, click **+ Add a scope** and add these two:
   - `data.records:read`
   - `schema.bases:read`
5. Under **Access**, click **+ Add a base** and choose **Relentless AI - client_test**
   *(if you're not sure which, you can add **All current and future bases** — it's your own account).*
6. Click **Create token**.
7. **Copy the token** (it starts with `pat...`). ⚠️ Airtable shows it **only once** — copy it now.

## Step 2 — Give it to me

Paste the token here in the chat. I'll:
- add it to `relentless-web/.env.local` (server-side only, gitignored — never exposed),
- auto-find your `client_test` base,
- test that the app reads your real scores/briefings,
- then wire the dashboard to show them (with the current placeholders as a safe fallback).

> Later, when we connect the **write** side (web → SMS backend), I'll ask you to add
> `data.records:write` to this same token. Read-only is all we need right now.

## Why a separate token (not n8n's)?
Your n8n token lives only inside n8n and can't be read out. A dedicated read-only token for the
web app is also better security — if it ever leaked, it could only *read* this one base, nothing else.
