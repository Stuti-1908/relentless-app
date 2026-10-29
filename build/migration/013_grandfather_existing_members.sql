-- ============================================================================
-- Relentless AI — keep access for every member who joined before paid sign-up went live.
--
-- From 2026-10-29 the app requires payment_verified = true for /dashboard,
-- /onboarding, /settings and /connections (enforced server-side in src/proxy.ts).
-- Existing members never paid through Stripe (they joined in the free beta), so
-- without this they would be sent to /payment. They are marked
-- subscription_status = 'grandfathered', shown as "Founding member" in Settings,
-- and are untouched by Stripe webhooks (no stripe_subscription_id).
--
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

update public.profiles
set payment_verified    = true,
    payment_verified_at = coalesce(payment_verified_at, now()),
    subscription_status = 'grandfathered'
where created_at < '2026-10-29T00:00:00Z'
  and stripe_subscription_id is null
  and coalesce(subscription_status, '') <> 'grandfathered';

-- Verification: every pre-cutoff member now has access.
--   select full_name, payment_verified, subscription_status from public.profiles order by created_at;
