# Market Signals fix — NewsData.io setup (one-time, ~5 min)

**The bug:** Market Signals had no real news source — Claude was asked to "give me this week's
market signal" with zero live context, so it fabricated plausible-sounding but stale/wrong-dated
items (e.g. "Walmart Q1 2025... Jun 26" when today is Jul 3). Fixed code is ready in
`build/n8n/_deploy_p1/market000001.json` (verified 12/12 offline) — it now pulls real, dated
headlines from NewsData.io and has Claude synthesize ONE signal grounded in them, or skip
sending rather than invent one.

## What you need to do

1. Go to **https://newsdata.io/register** — sign up free, **no credit card required**.
2. After signup, your API key is shown on the dashboard (also under **API Key** in the left menu).
   Copy it.
3. Free tier: **200 requests/day**, `latest` news endpoint, more than enough (market000001 runs
   once/week per client).

## Give me the key one of two ways

- **Fastest:** paste the key here in chat and I'll add it as an n8n credential during deploy (I
  won't display it back to you in plain text after that point).
- **Or:** SSH in yourself and set it as an environment variable on the container:
  ```
  ssh -i ~/.ssh/id_dadaai root@167.233.94.171
  # add NEWSDATA_API_KEY=<your key> to /root/n8n/.env (or docker-compose environment section)
  cd /root/n8n && docker compose restart n8n
  ```

Once the key is in place, I'll deploy the fixed `market000001` workflow the same safe way as the
other fixes (direct-DB, backup, verify, no downtime).
