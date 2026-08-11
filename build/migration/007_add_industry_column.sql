-- ============================================================================
-- Relentless AI - fix: Market Intelligence has never worked for any client,
-- because industry/keywords were never captured anywhere - not in the old
-- Airtable schema, not in Supabase, not in the onboarding form.
--
-- Found 2026-08-11: market000001's decide node falls back to the literal
-- string 'their industry' when p.industry is unset - which is EVERY client,
-- always, because the column does not exist. fetchNews then searches
-- newsdata.io for q="their industry", gets back generic/irrelevant headlines,
-- and Claude (correctly, per its own prompt instruction "if none are
-- relevant, say so briefly instead of forcing a connection") declines to
-- fabricate a signal. The "None of these headlines are relevant..." message
-- a client sees is the system working honestly on garbage input, not a bug
-- in the AI or the prompt.
--
-- industry is backfilled for existing clients by a one-time inference pass
-- (see build/n8n/_infer_client_industry.py) using GHL task history and past
-- nudge content - the only real signal available, since top_priority_1 is
-- null for every current client. New clients should have this collected
-- directly in onboarding going forward (separate, product-side change, not
-- part of this migration).
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================================

alter table public.client_profile add column if not exists industry text;
alter table public.client_profile add column if not exists market_keywords text;

-- v_clients must expose both, or market000001's decide node (which reads
-- through v_clients, same as every other converted workflow) will keep
-- falling back to the placeholder even after this column is populated.
create or replace view public.v_clients
with (security_invoker = on) as
select
  cp.client_id,
  coalesce(cp.timezone_override, p.timezone, 'America/New_York') as timezone,
  coalesce(cp.phone_override,    p.phone)                        as phone_number,
  p.full_name,
  p.ghl_contact_id,
  p.plan,
  cp.active,
  cp.onboarding_day,
  cp.onboarded_date,
  cp.top_priority_1,
  cp.delivery_hour,
  cp.industry,
  cp.market_keywords
from public.client_profile cp
left join public.profiles p using (client_id);

-- Verification:
--   select client_id, industry, market_keywords from public.v_clients limit 3;
--   -- expect the two new columns present (industry/market_keywords will be
--   -- null until 008 or the manual backfill runs)
