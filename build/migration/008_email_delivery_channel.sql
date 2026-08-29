-- ============================================================================
-- Relentless AI — add email delivery channel for international clients.
--
-- Requested 2026-08-16: non-US clients should receive nudges, reminders,
-- briefings, EOD/weekly/monthly, and War Room via Gmail instead of SMS, with
-- two-way reply support. Everything else (GHL contact record, GHL task
-- tracking) stays exactly as-is for these clients — only the message
-- transport for the coaching conversation itself changes.
--
-- Detection is by PHONE NUMBER COUNTRY-CODE PREFIX, not timezone. Live data
-- as of 2026-08-11's audit showed a client with a non-US (+91) phone number
-- but timezone defaulted to 'America/New_York' (never captured) — timezone
-- alone would have silently misrouted that client to SMS. Phone prefix is
-- computed here as a generated column so it's always in sync with
-- phone_number, the same way v_clients coalesces phone_override.
--
-- delivery_channel_override follows the existing phone_override /
-- timezone_override escape-hatch pattern for the handful of clients this
-- heuristic will get wrong (e.g. a US client traveling, or a client who
-- explicitly prefers email).
--
-- Run this ONCE in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================================

alter table public.client_profile add column if not exists email text;
alter table public.client_profile add column if not exists delivery_channel_override text
  check (delivery_channel_override in ('sms', 'email'));

-- v_clients must expose email + a computed delivery_channel, or every
-- outbound workflow's new channel gate will have nothing to read.
--
-- International = phone_number does NOT look like a NANP (+1) number.
-- Treated as a simple prefix check: US/Canada numbers are '+1' followed by
-- 10 digits, or a bare 10-digit string (some legacy rows have no '+'
-- prefix at all — same ambiguity the old timezone fallback had to work
-- around). Anything else is treated as international.
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
  cp.market_keywords,
  cp.email,
  coalesce(
    cp.delivery_channel_override,
    -- Never route to email without an address on file, no matter what the
    -- phone prefix says — an unreachable client is worse than a US-routed
    -- SMS is wrong-country. This is the fail-safe default; the override
    -- column is still there for anyone who needs to force one channel.
    case
      when cp.email is null then 'sms'
      when coalesce(cp.phone_override, p.phone) ~ '^\+1[0-9]{10}$' then 'sms'
      when coalesce(cp.phone_override, p.phone) ~ '^[0-9]{10}$'    then 'sms'
      else 'email'
    end
  ) as delivery_channel
from public.client_profile cp
left join public.profiles p using (client_id);

-- inbound_seen's `kind` column (003_schema_inbound_router.sql) is already
-- generic text, not GHL-specific — no schema change needed there, a new
-- Gmail-inbound workflow can write kind='gmail_inbound' as-is.
--
-- pending_replies.inbound_msg_id is already generic text (not GHL-specific
-- in name) — reused as-is to hold a Gmail message id for email-routed
-- clients. No schema change needed there either.

-- Verification:
--   select client_id, full_name, phone_number, email, delivery_channel
--   from public.v_clients order by full_name;
--   -- expect delivery_channel='email' only for genuinely non-US numbers;
--   -- spot-check against known clients before trusting it for a real send.
--
--   -- email will be NULL for everyone until backfilled — a client whose
--   -- computed delivery_channel is 'email' but has no email on file needs
--   -- either a delivery_channel_override='sms' fallback or an email address
--   -- collected before their next scheduled send, or every Gmail-branch
--   -- send node in the workflows below will silently fail for them.
