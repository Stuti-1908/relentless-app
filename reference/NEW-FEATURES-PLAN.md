# Relentless AI — New Features Implementation Plan (2026-06-18)

Two assets to fold into Relentless AI:
1. **Morning AI Briefing (6-source)** — `morning-ai-briefing-carousel.pdf`
2. **SMB Growth Diagnostic** — `smb diagnostic.pdf`

---

## Feature 1 — 6-Source Morning AI Briefing

**Concept (from the carousel):** one morning briefing that replaces 6 apps —
Email · Calendar · CRM · Slack · Sales dashboard · Industry news. "Built once, delivered daily by
text, email, or voice."

**How it maps to Relentless AI:** this is a major *expansion* of the existing Morning Briefing
workflow (`D6u7ItI5CjwOlW75`), which today is recovery + top-3 priorities. We turn it into a
**multi-source executive briefing assembler**.

### Source-by-source buildability (be honest about credentials)
| # | Source | Status | How |
|---|--------|--------|-----|
| 1 | **Email** — "what needs a reply" | 🔴 BLOCKED | Needs Gmail/Outlook OAuth per client. New `WHOOP-style` JIT OAuth + n8n Gmail node. Defer until creds. |
| 2 | **Calendar** — today's meetings prepped | 🟡 PARTIAL | We have meetings in Supabase (web) + Google Calendar OAuth deferred. Near-term: pull Supabase `meetings`; full: Google Calendar OAuth. |
| 3 | **CRM** — new leads, stalled deals, who's gone quiet | 🟢 BUILDABLE | **GHL is connected** (`services.leadconnectorhq.com`). Pull contacts + opportunities; flag stalled (no activity N days). |
| 4 | **Slack** — tagged threads summarized | 🔴 BLOCKED | Needs Slack OAuth + `channels:history`. Defer until creds. |
| 5 | **Sales** — yesterday revenue/refunds/anomalies | 🔴 BLOCKED | Needs Stripe/GHL-payments. Near-term: GHL opportunity pipeline value. Defer real revenue. |
| 6 | **News** — only relevant | 🟢 DONE | Reuse `market000001` (Claude market-intel) → `tbl_market_signals`. |

### Architecture
- **New Airtable fields** on `tbl_client_profile`: `briefing_sources` (multi-select of enabled
  sources), plus per-source OAuth token refs (reuse the §5.0.6 JIT pattern).
- **New assembler node** in the briefing workflow: gather whatever sources are connected →
  feed a single structured context block to Claude → Claude writes the unified briefing.
- **Graceful degradation:** each source is optional; the briefing renders with whatever's available
  (today: priorities + recovery + CRM + news + calendar).
- **Delivery:** SMS today; "email or voice" later (email via GHL/Resend; voice via a TTS + call API).
- **Dashboard:** a richer "Morning Briefing" card with per-source sections (Email/Calendar/CRM/…)
  each collapsible.

### Build order (Feature 1)
1. **CRM section** (GHL) — pull stalled deals + new leads into the briefing context. *(buildable now)*
2. **Calendar section** — fold today's Supabase meetings into the briefing. *(buildable now)*
3. **News section** — wire the existing market signal into the briefing. *(buildable now)*
4. **Assembler + Claude prompt** — unify the available sources into one briefing. *(buildable now)*
5. Email / Slack / Sales — **deferred**, gated on per-client OAuth (Gmail, Slack, Stripe).

---

## Feature 2 — SMB Growth Diagnostic (BUILD NOW — fully self-contained)

**Concept (from the PDF):** "Find out exactly why your business isn't growing. Answer 9 questions,
get a personalized AI diagnosis + specific fixes in under 3 minutes." Q1 = pricing (A/B/C/D).
A lead-gen + onboarding funnel. **No external integrations — just Next.js + Claude.** Highest ROI to
build immediately.

### Architecture
- **New web route** `relentless-web/src/app/diagnostic/page.tsx` — a 9-question stepped quiz in the
  existing design system (navy/gold, DM Sans), public (no auth), mobile-first.
- **9 questions** (PDF only gives Q1; design the rest across the SMB growth levers):
  1. Pricing · 2. Lead flow · 3. Sales/closing · 4. Retention/churn · 5. Marketing/visibility ·
  6. Operations/time · 7. Cash/finance · 8. Team/delegation · 9. Focus/strategy.
  Each A–D answer carries a hidden score (A=best … D=worst).
- **New API route** `src/app/api/diagnostic/route.ts` (public POST) — takes the 9 answers, computes a
  per-area score, asks **Claude** for a personalized diagnosis: the #1 growth bottleneck, why, and 3
  specific fixes. Returns structured JSON.
- **Results screen** — shows the diagnosis + fixes, then a **lead-capture CTA** ("Get your full plan
  → enter email/phone") that writes to Airtable `tbl_leads` (new table) and can kick off onboarding.
- **Optional:** the diagnostic doubles as the **Relentless onboarding intake** for new clients
  (prefills business_stage, pricing posture, biggest constraint).

### Build order (Feature 2) — all buildable now
1. `tbl_leads` Airtable table (name, email, phone, answers JSON, diagnosis, created_at).
2. `diagnostic/page.tsx` — the 9-step quiz UI (stepper, progress, A–D cards, design-system styled).
3. `api/diagnostic/route.ts` — score + Claude diagnosis (public, rate-limited, no secrets to client).
4. Results + lead-capture → write `tbl_leads`.
5. Deploy + smoke-test.

---

## Recommended sequencing
- **Now:** Build Feature 2 (SMB Diagnostic) end-to-end — self-contained, high lead-gen value, matches
  the PDF, deployable today.
- **Next:** Feature 1 buildable subset (CRM + Calendar + News assembler) on the briefing.
- **Later (needs creds):** Email (Gmail), Slack, Sales (Stripe) sources; voice/email delivery.

## Credentials needed from the user (for the blocked parts)
- Gmail/Google Workspace OAuth (Email + full Calendar).
- Slack app + OAuth token (`channels:history`, `users:read`).
- Stripe (or other) for real revenue/refunds.
