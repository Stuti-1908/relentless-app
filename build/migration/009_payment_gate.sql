-- ============================================================================
-- Relentless AI — payment gate before onboarding/dashboard access.
--
-- Requested 2026-08-17: everyone pays $69/month via a Square Payment Link
-- before they can reach onboarding or the dashboard. No free tier. Flow:
--   /login (signup) -> /consent -> /payment -> Square hosted checkout
--   -> redirect back to /payment/confirm -> /onboarding -> /dashboard
--
-- payment_verified gates access; payment_verified_at is a timestamp for
-- support/audit ("when did this person's payment gate open"). Neither
-- column implies an ACTIVE subscription over time -- this is a one-time
-- gate check at signup, not a recurring billing-status field. If/when real
-- Square API verification is added (see route.ts comments -- NOT built as
-- of this migration, redirect-trust only), a `square_order_id` /
-- `square_payment_id` column should be added then to record what was
-- actually verified, rather than trusting the boolean alone.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================================

alter table public.profiles add column if not exists payment_verified boolean not null default false;
alter table public.profiles add column if not exists payment_verified_at timestamptz;

-- Verification:
--   select id, email, payment_verified, payment_verified_at from public.profiles limit 5;
