-- ============================================================================
-- Relentless AI — Airtable → Supabase migration, Phase 1 schema
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Phase 1 covers only the morning-briefing chain:
--     client roster → morning check-in → briefing → 7AM fallback
-- Phase 2 (daily_scores, biometrics, nudges, business_health, dead_letter,
-- market_signals, inbound_seen, war_room_sessions, leads) lands in 002.
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / OR REPLACE.
--
-- ⚠ REQUIRES POSTGRES 15+ for `with (security_invoker = on)` on views.
--   If you get: `unrecognized parameter "security_invoker"` — STOP and tell me.
--   Do NOT simply delete that clause: without it the views run with the
--   creator's rights and silently BYPASS the RLS policies in §6, exposing
--   every client's rows to every signed-in user. On PG<15 the fix is to keep
--   the views out of the browser's reach and query base tables directly.
-- ============================================================================

-- ── 0. Prerequisite ─────────────────────────────────────────────────────────
-- client_profile.client_id references profiles.client_id, so that column needs
-- a unique constraint. All 11 existing client_ids are already distinct, so this
-- will not fail; if it ever does, there are duplicate client_ids to clean up.
-- NOTE: deliberately NOT a partial index. Postgres requires a non-partial
-- unique index as a foreign-key target, so `where client_id is not null`
-- would make the client_profile FK below fail. Plain unique is correct here:
-- Postgres treats NULLs as distinct, so multiple unprovisioned profiles with
-- a NULL client_id remain allowed.
create unique index if not exists profiles_client_id_key
  on public.profiles (client_id);

-- ── 1. client_profile ───────────────────────────────────────────────────────
-- Deliberately holds ONLY the coaching-specific fields that Airtable's
-- tbl_client_profile has and public.profiles lacks. Identity (name, phone,
-- timezone, GHL id, plan) stays in profiles as the single source of truth —
-- duplicating it here is what created the Airtable/Supabase split-brain.
create table if not exists public.client_profile (
  client_id         text primary key references public.profiles (client_id),
  active            boolean not null default true,
  onboarding_day    int     not null default 2,
  onboarded_date    date,
  top_priority_1    text,

  -- Per-client local delivery hour (0-23). NULL = use the workflow's default.
  -- This is what makes briefings land at each client's own morning.
  delivery_hour     int check (delivery_hour between 0 and 23),

  -- Escape hatches for legacy clients that exist in Airtable but have no
  -- profiles row. Normally NULL; v_clients coalesces over them.
  phone_override    text,
  timezone_override text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── 2. pending_replies ──────────────────────────────────────────────────────
-- Open conversation slots awaiting an inbound SMS reply.
-- pending_id is the natural key: Airtable nodes updated rows by opaque recXXX
-- record ids, and the converted n8n nodes key off this instead.
create table if not exists public.pending_replies (
  id             uuid primary key default gen_random_uuid(),
  pending_id     text unique not null,
  client_id      text not null references public.client_profile (client_id) on delete cascade,
  ghl_contact_id text,
  expected_type  text not null,                   -- 'morning_checkin', ...
  status         text not null default 'open',    -- open | matched | expired
  context_ref    text,
  inbound_msg_id text,
  matched_reply  text,
  opened_at      timestamptz not null default now(),
  expires_at     timestamptz,
  constraint pending_replies_status_chk
    check (status in ('open', 'matched', 'expired'))
);

create index if not exists pending_replies_lookup_idx
  on public.pending_replies (client_id, expected_type, status);
create index if not exists pending_replies_open_idx
  on public.pending_replies (status) where status = 'open';

-- ── 3. briefings ────────────────────────────────────────────────────────────
create table if not exists public.briefings (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null references public.client_profile (client_id) on delete cascade,
  date          date not null,
  briefing_text text,
  briefing_ran  boolean not null default false,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (client_id, date)
);

-- ── 4. v_clients — the single read surface for n8n ──────────────────────────
-- Every workflow's loadProfile node reads THIS, not the base tables.
-- One flat row per client with identity resolved, so no workflow needs a join.
create or replace view public.v_clients
with (security_invoker = on) as
select
  cp.client_id,
  coalesce(cp.timezone_override, p.timezone, 'America/New_York') as timezone,
  coalesce(cp.phone_override,    p.phone)                        as phone_number,
  p.full_name,
  -- NOTE: public.profiles has no email column (email lives in auth.users).
  -- The Phase 1 briefing chain addresses clients via GHL/SMS, not email, so
  -- it is deliberately not exposed here. If a workflow ever needs it, join
  -- auth.users on profiles.id rather than duplicating the column.
  p.ghl_contact_id,
  p.plan,
  cp.active,
  cp.onboarding_day,
  cp.onboarded_date,
  cp.top_priority_1,
  cp.delivery_hour
from public.client_profile cp
left join public.profiles p using (client_id);

-- ── 5. Views that absorb the Airtable formulas the Supabase node can't express ──
-- briefFallback1 previously used:
--   AND({status}='open', OR({expires_at}='', IS_AFTER({expires_at}, NOW())))
-- The Supabase node's filter UI only ANDs simple comparisons, so the OR lives
-- here instead and the node does a plain unfiltered getAll.
create or replace view public.v_open_pending_replies
with (security_invoker = on) as
select *
from public.pending_replies
where status = 'open'
  and (expires_at is null or expires_at > now());

-- slaMonitor1 previously used:
--   AND({expected_type}='morning_checkin', DATETIME_DIFF(NOW(),{opened_at},'hours')<=26)
create or replace view public.v_recent_morning_checkins
with (security_invoker = on) as
select *
from public.pending_replies
where expected_type = 'morning_checkin'
  and opened_at >= now() - interval '26 hours';

-- ── 6. Row Level Security ───────────────────────────────────────────────────
-- n8n connects with the service_role key and bypasses RLS entirely (it is a
-- trusted backend). These policies constrain the BROWSER (anon key + user JWT)
-- so a signed-in user can only ever see their own client's rows.
alter table public.client_profile  enable row level security;
alter table public.pending_replies enable row level security;
alter table public.briefings       enable row level security;

-- Helper: the client_id belonging to the currently signed-in user.
create or replace function public.current_client_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select client_id from public.profiles where id = auth.uid()
$$;

drop policy if exists "client_profile: own row read" on public.client_profile;
create policy "client_profile: own row read"
  on public.client_profile for select
  using (client_id = public.current_client_id());

drop policy if exists "pending_replies: own rows read" on public.pending_replies;
create policy "pending_replies: own rows read"
  on public.pending_replies for select
  using (client_id = public.current_client_id());

drop policy if exists "briefings: own rows read" on public.briefings;
create policy "briefings: own rows read"
  on public.briefings for select
  using (client_id = public.current_client_id());

-- Note: no INSERT/UPDATE/DELETE policies for the browser. All writes to these
-- tables come from n8n via the service_role key. If the dashboard ever needs to
-- write, add a narrowly-scoped policy then — do not open these up pre-emptively.

-- ── 7. Seed the roster from the existing profiles rows ──────────────────────
-- All 11 known clients already exist in profiles with a client_id, so the
-- roster does not need a CSV import. Airtable-only fields (onboarding_day,
-- onboarded_date, top_priority_1) are backfilled from CSV afterwards.
insert into public.client_profile (client_id, active)
select client_id, true
from public.profiles
where client_id is not null
on conflict (client_id) do nothing;

-- ── 8. Verification — run these and eyeball the output ──────────────────────
-- Expect 11 rows, each with a timezone and (for real clients) a ghl_contact_id.
--   select client_id, full_name, timezone, ghl_contact_id, active,
--          delivery_hour from public.v_clients order by full_name;
--
-- Expect RLS enabled (rowsecurity = true) on all three tables:
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public'
--     and tablename in ('client_profile','pending_replies','briefings');
