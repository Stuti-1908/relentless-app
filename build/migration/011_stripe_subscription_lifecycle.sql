-- ============================================================================
-- Relentless AI — Stripe subscription lifecycle (2026-10-24).
--
-- Supersedes 010 (which was never applied: profiles had no stripe_* columns, so
-- the webhook's update failed on every real payment). Includes 010's columns.
-- Adds subscription_status so cancellations / failed renewals revoke access.
--
-- Run ONCE in the Supabase SQL Editor (project iqdkoufpiafbhmicbdsy). Safe to re-run.
-- ============================================================================

alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_checkout_session_id text;
alter table public.profiles add column if not exists subscription_status text;

create index if not exists profiles_stripe_subscription_id_idx
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

notify pgrst, 'reload schema';

-- Verification (expect 4 rows):
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='profiles'
--     and column_name in ('stripe_customer_id','stripe_subscription_id','stripe_checkout_session_id','subscription_status');
