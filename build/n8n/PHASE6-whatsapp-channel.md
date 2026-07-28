# Phase 6 — International delivery / WhatsApp channel (decision doc)

**Status: needs a business decision from you. No code built yet — this documents the options so you
can choose, then I build the chosen path.**

## The hard constraint
GHL / LeadConnector runs on US A2P 10DLC. It **cannot reliably deliver SMS to +91 (India), +234
(Nigeria), +92 (Pakistan)** and most non-US numbers. 6 of your 14 test clients have non-US numbers
(+91/+234). Even with every code fix deployed, those numbers likely still won't receive SMS. This is
a carrier/platform limit, not a bug in our workflows.

## What already works
- **US numbers via GHL SMS** — the whole system (briefings, nudges, EoD, reminders) delivers fine.
- **WhatsApp** — already proven end-to-end via the Twilio WhatsApp Sandbox during earlier testing.

## Options

### Option A — US-only beta now (recommended to start)
Onboard only US (+1) clients for the beta. Everything works today with the fixes deployed. Non-US
prospects go on a waitlist until Option C ships. Zero extra build. **Fastest path to a clean beta.**

### Option B — Twilio international SMS per region
Add Twilio senders with country-appropriate origination (e.g. an Indian sender ID for +91). High
setup cost: per-country registration, sender IDs, DLT (India) template pre-registration, and a
second send path in every workflow. Heavy; not recommended for beta.

### Option C — WhatsApp Business channel for non-US (recommended fast-follow)
Route non-US clients over WhatsApp (Twilio WhatsApp Business API, out of sandbox). WhatsApp is the
primary messaging channel in India/Nigeria/etc., so this is arguably *better* than SMS for those
users. Requires:
- Twilio WhatsApp Business sender (approved, out of sandbox) + message templates for the outbound
  briefings/nudges (WhatsApp requires pre-approved templates for business-initiated messages).
- A per-client `channel` field (`sms` | `whatsapp`) on `tbl_client_profile`, defaulting by country
  code (+1 → sms, else → whatsapp).
- A send abstraction in each sender: branch on `channel` → GHL SMS node OR Twilio WhatsApp node.
  (~1 IF + 1 HTTP node per sender; the inbound webhook already handled WhatsApp in sandbox.)

## Recommendation
**Ship the beta US-only now (Option A)** — it's clean and everything works. **Build Option C as the
immediate fast-follow** so India/Nigeria clients come on over WhatsApp. Option B only if a specific
client contractually needs native SMS in a country WhatsApp doesn't cover.

## If you choose C, what I'll build
1. Add `channel` to `tbl_client_profile` (+ default-by-country logic in provisioning).
2. A shared "send message" sub-pattern (IF channel → GHL SMS | Twilio WhatsApp) dropped into each
   sender, mirroring the existing GHL send node.
3. Confirm the Twilio WhatsApp templates for: morning check-in, briefing, nudge, EoD score, weekly,
   reminders (6 templates; WhatsApp needs each pre-approved).

**Decision needed:** A only (US beta now) / A+C (US now, WhatsApp fast-follow) / B (Twilio intl SMS).
