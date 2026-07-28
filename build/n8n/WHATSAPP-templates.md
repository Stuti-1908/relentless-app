# WhatsApp message templates — for Meta approval submission

WhatsApp requires every **business-initiated** message (one the user didn't just reply to) to use a
pre-approved Content Template. Submit these 6 through Twilio's Content Template Builder (or Meta
Business Manager directly) once your WhatsApp Business sender is approved. Each takes its own
review (usually faster than the initial sender approval — often same-day).

Variables use `{{1}}`, `{{2}}` etc. (WhatsApp's numbered-placeholder format).

---

### 1. Morning check-in
**Category:** UTILITY
```
Good morning {{1}}! Before I build your plan, reply 3 numbers 1-5: sleep energy stress
(e.g. 4 3 2).
```

### 2. Morning briefing
**Category:** UTILITY
```
{{1}}'s briefing: {{2}}

Reply anytime with how it's landing.
```
*(`{{2}}` is the full personalized briefing text — templates allow one flexible free-text body
variable; confirm max length with Twilio, typically 1024 chars.)*

### 3. Real-time nudge
**Category:** UTILITY
```
{{1}}
```
*(nudges are short single-line coaching prompts — the whole nudge text is the one variable)*

### 4. End-of-day Executive Score
**Category:** UTILITY
```
Today's Executive Score: {{1}}/100 ({{2}}).
{{3}}
```
*(`{{2}}` = score label e.g. "Steady"/"Strong", `{{3}}` = one-line coach note)*

### 5. Weekly business-health / stage plan
**Category:** UTILITY
```
This week's focus: {{1}}
```

### 6. Meeting / recurring reminder
**Category:** UTILITY
```
Reminder: {{1}} in about 5 minutes. Reply DONE or SKIP.
```

---

## Submission notes
- Use **UTILITY** category (not MARKETING) — these are account-servicing/coaching notifications
  the user opted into, not promotions. Utility templates get faster approval and no per-message
  marketing surcharge.
- Keep language simple, no emojis, matches the existing SMS voice guide (plain ASCII, one question
  where relevant) — Meta rejects templates that look like spam or have vague/generic wording.
- Submit all 6 at once; approval is typically 1 business day per template once the sender itself
  is approved.
- Once approved, each template gets a `ContentSid` (e.g. `HXxxxxxxxx...`) — swap that into the
  `sendWhatsApp` node's body in place of free-form `Body` (see `_deploy_whatsapp/sendWhatsApp.node.json`
  which has this called out as a TODO).
