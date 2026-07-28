# Relentless AI — Web App Build Roadmap

> **What this is:** the complete remaining plan for the `relentless-web` app, broken into phases.
> Each phase has its own file with granular steps. Read top-to-bottom; phases are ordered by
> dependency. "👤 You" = a step only you can do (clicks/secrets). "🤖 Me" = I build/verify it.
>
> Last updated: 2026-06-10 · Owner: Claude (build) + Stuti (approvals/secrets)

---

## Where we are now (✅ DONE)

| # | Capability | Status |
|---|-----------|--------|
| 1 | Next.js app, 4 screens ported (login → consent → onboarding → dashboard) | ✅ live |
| 2 | Supabase Auth (email+password), route protection, sign-out | ✅ live |
| 3 | Consent gate persisted to Supabase | ✅ live |
| 4 | Profile + onboarding form (name, phone, company, role, timezone, goal) | ✅ live |
| 5 | Tasks — per-user, persisted, RLS-secured (add/check/delete/voice) | ✅ live |
| 6 | Meetings — per-user, persisted, RLS-secured (add/delete) | ✅ live |
| 7 | **Read bridge:** dashboard shows REAL score/recovery/briefing/trend from Airtable | ✅ live |

The web app and the n8n/Twilio/Airtable backend now **share one source of truth (read direction).**

---

## Remaining phases (the plan)

| Phase | File | Goal | Needs from you | Effort | Depends on |
|-------|------|------|----------------|--------|-----------|
| **W1** | [01-write-path-profile.md](01-write-path-profile.md) | Web profile → Airtable so the SMS briefing uses YOUR name/phone/priorities | Add `data.records:write` to token; confirm client_id | M | done #4, #7 |
| **W2** | [02-write-path-tasks.md](02-write-path-tasks.md) | Web to-dos → GHL so they feed the Execution score + nudges | Confirm GHL contact mapping | M–L | W1 |
| **W3** | [03-multi-client-mapping.md](03-multi-client-mapping.md) | Move past the single test client → each login maps to its own client base | Decide provisioning model | L | W1 |
| **P1** | [04-polish-and-hardening.md](04-polish-and-hardening.md) | Profile-edit, edit-task, loading/error states, mobile, nav tabs | Review/approve UX | M | none (anytime) |
| **D1** | [05-deploy-vercel.md](05-deploy-vercel.md) | Put it on the internet with a real URL (open on your phone) | GitHub + Vercel accounts; ~15 min of clicks | M | P1 recommended first |
| **A1** | [06-google-login.md](06-google-login.md) | "Continue with Google" actually works | Google Cloud + Supabase clicks | S | none |
| **F1** | [07-future-pro-features.md](07-future-pro-features.md) | Client View, Admin View, War Room (Pro), Capital/Risk, reports | Product decisions | XL | most of the above |

Effort key: **S** ≈ <1 session · **M** ≈ 1 session · **L** ≈ 2–3 sessions · **XL** ≈ multi-week.

---

## Recommended order (and why)

1. **W1 — Profile write path** *(next)* — small, high-impact: what you type in the app starts driving
   the real SMS. Closes the loop from read-only to read+write.
2. **W2 — Tasks write path** — makes the Execution pillar reflect your actual work.
3. **P1 — Polish** — before showing anyone or deploying, make it feel finished.
4. **D1 — Deploy** — get a live URL. (Do P1's "protect the API for production" item as part of this.)
5. **A1 — Google login** — nice-to-have; do whenever.
6. **W3 — Multi-client** — only needed when you onboard a *second* real client.
7. **F1 — Pro features** — the big roadmap (War Room etc.), per the master spec, after Standard is solid.

> You can reorder freely. If your priority is "show a live link to someone this week," jump to
> **P1 → D1** and defer the write paths.

---

## Cross-cutting (applies to every phase)

- **Security:** secrets stay in `.env.local` (gitignored) / Vercel env vars — never in the browser or git.
  Supabase RLS is ON for all tables. The Airtable token is server-side only.
- **Verification-first:** every phase ends with a concrete test (a real read/write proven), not "looks done."
- **Non-breaking:** real data always falls back to a safe placeholder if missing — the UI never crashes.
- **HANDOFF.md:** the parent project's `GoeCoach-Plan/HANDOFF.md` is updated as each phase lands.

---

## Key facts the plans rely on (so future sessions don't re-derive them)

- App lives in `D:\DIGITAL DADA\GoeCoach-Plan\relentless-web`. Run: `npx next dev -p 3003`.
- **Supabase** project `iqdkoufpiafbhmicbdsy` — auth + tables `profiles`, `tasks`, `meetings` (all RLS-own-row).
- **Airtable** client_test base = **`appjnWxg9sB3PV7Da`** (pinned in `.env.local` as `AIRTABLE_BASE_ID`).
  Read token in `.env.local` as `RELENTLESS_WEB_APP_AIRTABLE_TOKEN` (scopes: data.read + schema.read).
- **n8n/Twilio/Airtable** backend already produces: briefings, daily scores (Body/Focus/Execution/Alignment),
  biometrics, nudges, feedback. Table/field names: `GoeCoach-Plan/build/airtable/SCHEMA.md`.
- **GHL** connected to n8n; Execution pillar reads GHL tasks (location `HlI90j86nBEuhp9Oovf9`,
  test contact `v8lIYQuHTAcLFmbJ0HUt`). See HANDOFF §5 (f)–(h).
- Claude model in backend: `claude-sonnet-4-6`. Twilio is trial → test inbound over WhatsApp Sandbox.
