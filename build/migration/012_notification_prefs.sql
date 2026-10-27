-- ============================================================================
-- Relentless AI — per-client notification preferences (dashboard Settings page).
--
-- notification_prefs is a flat jsonb of booleans. A MISSING key means ON, so every
-- existing client keeps receiving everything until they switch something off:
--   { "paused": true }                      -> pause every coaching message
--   { "morning_checkin": false, ... }       -> opt out of one category
-- Keys: morning_checkin, morning_briefing, nudges, evening_score, weekly,
--       monthly_report, onboarding, task_reminders, meeting_reminders.
-- Written only by /api/notification-prefs (service role, allow-listed keys);
-- read by every n8n send path through v_clients.
--
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.client_profile
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Same definition as 008 with notification_prefs APPENDED (create or replace view
-- can only add columns at the end).
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
    case
      when cp.email is null then 'sms'
      when coalesce(cp.phone_override, p.phone) ~ '^\+1[0-9]{10}$' then 'sms'
      when coalesce(cp.phone_override, p.phone) ~ '^[0-9]{10}$'    then 'sms'
      else 'email'
    end
  ) as delivery_channel,
  cp.notification_prefs
from public.client_profile cp
left join public.profiles p using (client_id);

-- Verification:
--   select client_id, notification_prefs from public.v_clients limit 5;  -- all {}
