# Phase D1 — Deploy to Vercel (go live with a real URL)

> **Goal:** put the app on the public internet so you can open it on your phone and share a link.
> Vercel is the natural host for Next.js (free tier is fine to start).

**Status:** ⬜ not started · **Effort:** M · **Depends on:** recommend P1's "protect /api" item first

> ⚠️ **Before deploying:** do the **"Protect `/api/*` for production"** item from
> [04-polish-and-hardening.md](04-polish-and-hardening.md). Until then the coaching API is only
> guarded by a redirect — fine on localhost, not safe public.

---

## 👤 You do (with me guiding click-by-click)
1. **GitHub account** (if you don't have one): github.com → sign up.
2. **Vercel account:** vercel.com → "Sign up" → **Continue with GitHub** (easiest).
3. When I say so, **authorize Vercel** to access the repo I push.
4. In Vercel, **paste 3–5 environment variables** (I'll give exact names + values to copy):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `RELENTLESS_WEB_APP_AIRTABLE_TOKEN`
   - `AIRTABLE_BASE_ID`
   - (+ `GHL_TOKEN` etc. once W2 exists)
5. In **Supabase → Authentication → URL Configuration**, add the Vercel URL to **Site URL** +
   **Redirect URLs** (I'll give the exact strings). This is required or login breaks in production.

---

## 🤖 I do
1. **`git init`** the `relentless-web` folder (confirm `.gitignore` covers `.env*`, `node_modules`,
   `.next` — it does), make the first commit.
2. Create a GitHub repo + push (via `gh` CLI or guide you through the web UI).
3. Walk you through **Vercel → New Project → import the repo** (framework auto-detected as Next.js).
4. Provide the **exact env-var list** to paste, and the **exact Supabase redirect URLs** to add.
5. Trigger the first deploy; **verify the production build passes** (it already does locally).
6. **Smoke-test the live URL:** signup → email confirm → consent → onboarding → dashboard → real data.
7. **(Optional) Custom domain** — if you own one (e.g. `app.relentless.ai`), I'll guide the DNS records.

---

## Production gotchas (I'll handle, listed so we don't get surprised)
- **Auth redirect URLs** must include the prod domain or Google/email-confirm links fail. (#5 above.)
- **Server env vars** (Airtable/GHL tokens) must be set in Vercel **without** the `NEXT_PUBLIC_` prefix
  so they stay server-only. The Supabase URL/anon key keep `NEXT_PUBLIC_`.
- **Email confirmation** uses Supabase's built-in SMTP (rate-limited). For real volume, configure a
  custom SMTP (SendGrid/Resend) in Supabase later.
- **`proxy.ts`** (our middleware) runs on Vercel's edge — already compatible; verify it after deploy.
- **Region:** pick a US region in Vercel (clients are US-based) for lower latency.
- **Cold-start latency** on the Airtable read — mitigated by the caching item in P1.

---

## ✅ Verification
- Open the Vercel URL on your **phone** → full flow works end-to-end.
- Log out → protected pages redirect to login on the live site.
- `/api/coaching` returns 401 when not logged in (after P1 hardening), real data when logged in.
- A new signup's confirmation email links back to the **production** domain (not localhost).

---

## Deliverables
- git repo + GitHub remote + first deploy
- `WEB-08-deploy.md` (the exact env vars + Supabase URLs + steps you followed)
- live URL recorded in HANDOFF.md
