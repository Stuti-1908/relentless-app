# Phase A1 — Google login ("Continue with Google")

> **Goal:** make the existing Google button actually sign people in. The code is already wired
> (`signInWithOAuth({ provider: 'google' })` + `/auth/callback`); it just needs the provider
> enabled + a Google OAuth credential.

**Status:** ⬜ not started · **Effort:** S (<1 session) · **Depends on:** nothing (do anytime).
Best done **after deploy (D1)** so we configure the production redirect URL once.

---

## 👤 You do (I guide every click)
### A. Google Cloud — create an OAuth client (~5 min)
1. **https://console.cloud.google.com** → create/select a project (e.g. `relentless-ai`).
2. **APIs & Services → OAuth consent screen** → External → fill app name, support email → Save.
   (Add yourself as a **Test user** so it works before Google verification.)
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID** → type **Web application**.
4. Under **Authorized redirect URIs**, add the value I give you — it's your Supabase callback:
   `https://iqdkoufpiafbhmicbdsy.supabase.co/auth/v1/callback`
5. **Create** → copy the **Client ID** and **Client secret**.

### B. Supabase — enable Google
6. Supabase → **Authentication → Sign In / Providers → Google** → toggle **Enabled**.
7. Paste the **Client ID** + **Client secret** → **Save**.

That's it — the button works. Paste me the Client ID/secret if you'd rather I document them; the
secret only lives in Supabase (not in our app), so it's safe there.

---

## 🤖 I do
- Verify the provider is live (the auth settings endpoint flips `google: true`).
- Test the OAuth round-trip: click Google → consent → `/auth/callback` exchanges the code → session →
  consent/onboarding/dashboard.
- For production (post-D1): add the **Vercel domain** to Supabase redirect URLs and (if needed) a second
  Google redirect URI. Confirm login works on the live site.
- Handle the edge case where a Google user and an email/password user share an email (Supabase links or
  errors — I'll set sensible behavior).

---

## ✅ Verification
- "Continue with Google" on **localhost** → lands on the dashboard, session persists on reload.
- After deploy: same flow works on the **live URL**.
- `auth/v1/settings` shows `"google": true`.

---

## Notes
- Until Google "verifies" your consent screen, only **Test users** you add can sign in — fine for now.
- No code changes expected; this is pure configuration. If the callback misbehaves I'll adjust
  `src/app/auth/callback/route.ts`.

---

## Deliverables
- Google provider live (local + prod)
- `WEB-09-google-login.md` (the exact steps + redirect URIs used)
- HANDOFF.md updated
