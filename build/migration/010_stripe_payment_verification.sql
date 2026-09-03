-- ============================================================================
-- Relentless AI — real server-side Stripe payment verification.
--
-- Requested 2026-08-29: switching from Square (redirect-trust only, known
-- accepted gap) to Stripe, specifically so payment can be VERIFIED
-- server-side via the Stripe API rather than trusted from a redirect alone.
--
-- stripe_customer_id / stripe_subscription_id are the actual proof a real
-- payment/subscription exists -- unlike the old payment_verified boolean
-- (kept, still used by the beta-bypass path and as the fast gate-check
-- column), these can be independently re-checked against Stripe's API at
-- any time (e.g. to detect a cancelled subscription later, not built yet).
--
-- payment_verified / payment_verified_at (009_payment_gate.sql) are left
-- as-is and still gate access -- Stripe's webhook handler sets them the
-- same way the old Square confirm route did, so onboarding/dashboard's
-- existing gate checks don't need to change at all.
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================================

alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_checkout_session_id text;

-- Verification:
--   select id, email, payment_verified, stripe_customer_id, stripe_subscription_id
--   from public.profiles limit 5;
