# Phase P1 — Polish & hardening

> **Goal:** make the app feel finished and trustworthy before anyone else sees it or it goes live.
> A grab-bag of smaller wins. Can be done anytime; recommended **before deploy (D1).**

**Status:** ⬜ not started · **Effort:** M · **Depends on:** nothing (do in any order)

---

## Checklist (each is small; tackle in batches)

### UX / screens
- [ ] **Profile-edit screen** — right now you can only set profile during onboarding. Add an
      account/settings page to edit name/phone/timezone/goal later (re-uses the onboarding form +
      W1 sync).
- [ ] **Edit a task** — change title/priority/meta after creating (currently add/check/delete only).
- [ ] **Nav tabs do something** — `Client View` / `Admin View` in the top bar are dead links. Either
      hide them for now or build stubs (full versions are F1).
- [ ] **"Last updated" + refresh** on the dashboard — show when coaching data was fetched; add a manual
      refresh + auto-refresh every few minutes.
- [ ] **Empty/edge states** — already have task/meeting empty states; add one for "no briefing yet today."

### Feel / responsiveness
- [ ] **Mobile pass** — it's an exec tool people open on phones. Verify the grid/cards stack cleanly on
      small screens; tap targets for check/delete; the trend chart scrolls if many bars.
- [ ] **Loading skeletons** instead of "Loading…" text for score/briefing cards.
- [ ] **Toasts** for actions (saved, synced, error) instead of inline-only notes.
- [ ] **Error boundary** — a friendly full-page fallback if something throws.

### Correctness / hardening
- [ ] **Protect `/api/*` for production** — currently the API is gated only by the proxy redirect.
      Add an explicit Supabase-session check inside each route handler (return 401 JSON, not an HTML
      redirect) so it's safe once deployed. **(Do this as part of D1 at the latest.)**
- [ ] **Rate-limit / cache** the Airtable reads (e.g. 60s cache) to avoid hammering the API on every load.
- [ ] **Consistent sign-out** + session-expiry handling (if the token dies mid-session, route to login).
- [ ] **Accessibility** — labels on icon buttons (some done), focus states, color contrast on the gold text.
- [ ] **Remove dead placeholders** that can't be real yet (clearly mark "SOON" — mostly done).

---

## 🤖 I build / 👤 You review
I implement in small batches and show you each; you approve the look/feel. No secrets needed except the
production API-protection item (no new secret, just code).

---

## ✅ Verification
- Resize the browser to phone width → everything readable, nothing overlaps.
- Edit profile → persists + (after W1) syncs.
- Hit `/api/coaching` while logged out → **401 JSON** (after the hardening item), not a redirect.
- Lighthouse/accessibility quick pass: no major contrast/label failures.

---

## Deliverables
- profile-edit + edit-task UI
- API route auth guards + caching
- mobile/responsive fixes, skeletons, toasts, error boundary
- HANDOFF.md updated
