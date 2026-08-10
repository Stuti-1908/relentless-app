-- ============================================================================
-- Relentless AI — fix: War Room's client lookup can't be reached from the web
-- dashboard, only from SMS.
--
-- Symptom (found 2026-08-10): a War Room session opened via the dashboard
-- (/api/warroom/route.ts) would silently fail every turn after the first -
-- loadProfile returned {} , routeTurn fell back to CID='client_test' and
-- plan='standard', found no session for that fake CID, and replied with
-- nothing. The chat looked stuck re-asking "PROBLEM, OPPORTUNITY, or
-- STRATEGY?" - actually a DIFFERENT bug from the routeTurn phase-read fix
-- shipped the same day (patched routeTurn to read sess.state instead of the
-- dead sess.focus_topic/sess.phase columns). Both bugs independently produced
-- symptoms that looked identical from the chat UI.
--
-- Root cause: /api/warroom/route.ts sends `contactId: clientId` (the app's own
-- client_id, e.g. "client_73bed63e") when relaying a dashboard turn to n8n's
-- War Room webhook — it has no GHL contact id to send, because the dashboard
-- session isn't an SMS conversation. warRoom0001's loadProfile node filters
-- v_clients_match.match_key against that contactId, but the view (built
-- 2026-08-06, see 004 §5b) only emits phone_number / digits-only-phone /
-- ghl_contact_id — never client_id. SMS traffic (Twilio/GHL) always supplies
-- a real phone or contact id, so this gap was invisible until the dashboard
-- path was exercised.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (CREATE OR REPLACE).
-- ============================================================================

create or replace view public.v_clients_match
with (security_invoker = on) as
select c.*, m.match_key
from public.v_clients c
cross join lateral (
  values
    (c.phone_number),
    (regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g')),
    (c.ghl_contact_id),
    (c.client_id)  -- lets the web dashboard's own client_id resolve a session too
) as m(match_key)
where m.match_key is not null
  and m.match_key <> '';

-- Verification:
--   select * from public.v_clients_match where match_key = 'client_test' limit 1;
--   -- expect one row, HTTP 200
