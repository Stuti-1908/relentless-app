-- ============================================================================
-- Relentless AI — stop signed-in users from editing their own access columns.
--
-- Security audit 2026-11-03: the profiles RLS policy lets a user update their own
-- row, and the table had no column restriction. Using only the public anon key,
-- any signed-in user could run
--   update profiles set payment_verified = true, plan = 'pro' where id = <self>
-- and skip payment (confirmed live with a throwaway test account), or point
-- ghl_contact_id at someone else's GoHighLevel contact.
--
-- Fix: the browser (role `authenticated`) may only write the personal fields the
-- app actually edits from the browser. Access/billing/identity columns are written
-- only by server routes with the service role (stripe-webhook, beta-bypass,
-- provision), which these grants do not affect. RLS still limits users to their
-- own row.
--
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

revoke insert, update on public.profiles from authenticated, anon;

-- Columns the web app writes with the user's own session:
--   onboarding/page.tsx (upsert), connections/page.tsx (disconnect),
--   auth/callback (Google tokens), api/connections/gmail/sync (summary).
grant insert (id, full_name, company, role, phone, timezone, primary_goal, onboarded, updated_at,
              google_calendar_refresh_token, google_calendar_connected_at,
              gmail_refresh_token, gmail_connected_at, gmail_last_sync, gmail_unread_summary,
              display_name, city, avatar_url, bio)
  on public.profiles to authenticated;

grant update (full_name, company, role, phone, timezone, primary_goal, onboarded, updated_at,
              google_calendar_refresh_token, google_calendar_connected_at,
              gmail_refresh_token, gmail_connected_at, gmail_last_sync, gmail_unread_summary,
              display_name, city, avatar_url, bio)
  on public.profiles to authenticated;

-- NOT writable from the browser any more: payment_verified, payment_verified_at, plan,
-- client_id, ghl_contact_id, airtable_base_id, stripe_customer_id, stripe_subscription_id,
-- stripe_checkout_session_id, subscription_status, is_admin, is_founding_member,
-- verification_status, auth_method, invited_by, referral_code_used, created_at.

-- Verification (should list only the columns granted above):
--   select privilege_type, column_name from information_schema.column_privileges
--   where table_name = 'profiles' and grantee = 'authenticated' order by 1, 2;
