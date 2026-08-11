-- ============================================================================
-- Relentless AI - fix: Monthly Report (monthly00001ghl) was reactivated with
-- 3 Airtable nodes still live, targeting tables that no longer exist there.
--
-- Found 2026-08-11: the workflow was turned active at some point after the
-- 2026-08-06 migration without being converted. Its Airtable filter,
-- targets tbl_client_profile/tbl_daily_scores/tbl_monthly_reports - the same
-- 429 PUBLIC_API_BILLING_LIMIT_EXCEEDED failure every other workflow hit
-- before conversion. Its cron is `0 8 1 * *` Asia/Kolkata (1st of the month),
-- so this was not yet an active incident, but it would have failed silently
-- the next time it fired.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS /
-- CREATE OR REPLACE guarded throughout).
-- ============================================================================

-- monthly_reports: one row per client per month. logReport (Airtable "create")
-- writes exactly these 7 columns plus report_sent_sms - captured from the live
-- node's column mapping, not guessed.
create table if not exists public.monthly_reports (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 text not null references public.client_profile (client_id) on delete cascade,
  month_year                text not null,             -- e.g. '2026-08', matches the workflow's own format
  monthly_score             numeric,
  base_score                numeric,
  trend_bonus                numeric,
  consistency_bonus         numeric,
  pillar_improvement_bonus  numeric,
  report_sent_sms           boolean not null default false,
  created_at                timestamptz not null default now(),
  unique (client_id, month_year)
);

create index if not exists monthly_reports_client_month_idx
  on public.monthly_reports (client_id, month_year desc);

-- v_daily_scores_last_31d: absorbs fetchScores' filter
--   AND({client_id}='client_test', DATETIME_DIFF(NOW(),{date},'days')<=31)
-- The hardcoded client_test was never updated when this workflow was fan-out
-- patched for per-client timezone gating (see aggregate's TZ guard, which
-- already treats $json as one profile item) - the Airtable node itself was
-- left on the single-client placeholder. Same pattern as
-- v_daily_scores_last_7d in 004: date arithmetic moves into the view, the
-- per-client narrowing stays as a plain eq on the converted node.
create or replace view public.v_daily_scores_last_31d
with (security_invoker = on) as
select *
from public.daily_scores
where date >= (current_date - 31);

alter table public.monthly_reports enable row level security;

drop policy if exists "monthly_reports: own rows read" on public.monthly_reports;
create policy "monthly_reports: own rows read"
  on public.monthly_reports for select
  using (client_id = public.current_client_id());

-- Verification:
--   select * from public.monthly_reports limit 1;         -- expect 0 rows, HTTP 200
--   select * from public.v_daily_scores_last_31d limit 1;  -- expect HTTP 200
