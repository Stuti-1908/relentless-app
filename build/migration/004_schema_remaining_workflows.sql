-- ============================================================================
-- Relentless AI — Airtable → Supabase migration, Phase 4
-- The last tables needed to take the remaining 12 workflows off Airtable.
--
-- Derived from an audit of all 34 remaining Airtable nodes: every column below
-- is one a live workflow actually reads or writes, not a guess at what might be
-- useful later.
--
-- Run this ONCE in the Supabase SQL Editor, AFTER 003_schema_inbound_router.
-- Same Postgres 15+ requirement for `security_invoker` — see 001's header.
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ── 1. nudges ───────────────────────────────────────────────────────────────
-- The Nudge Engine writes one row per nudge sent, and reads recent rows both to
-- throttle itself and to give the End-of-Day score its execution signal.
create table if not exists public.nudges (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null references public.client_profile (client_id) on delete cascade,
  timestamp      timestamptz not null default now(),
  nudge_content  text,
  trigger_reason text,
  responded      boolean not null default false
);

-- Supports both the throttle lookup and the 18-hour window view below.
create index if not exists nudges_client_ts_idx
  on public.nudges (client_id, timestamp desc);

-- ── 2. business_health ──────────────────────────────────────────────────────
-- Weekly Pro check-in: the client's own numbers plus Claude's written analysis.
-- One row per client per week; the unique constraint makes the weekly write
-- idempotent if the workflow is re-run.
create table if not exists public.business_health (
  id                uuid primary key default gen_random_uuid(),
  client_id         text not null references public.client_profile (client_id) on delete cascade,
  week_start_date   date not null,
  cash_position     text,
  team_health       text,
  biggest_risk      text,
  risk_deliberate   text,
  capital_score     numeric,
  risk_score        numeric,
  checkin_completed boolean not null default false,
  claude_analysis   text,
  created_at        timestamptz not null default now(),
  unique (client_id, week_start_date)
);

create index if not exists business_health_client_week_idx
  on public.business_health (client_id, week_start_date desc);

-- ── 3. dead_letter ──────────────────────────────────────────────────────────
-- Failure queue. Deliberately has NO foreign key on client_id: a dead-letter row
-- must survive even when the failure is that the client_id itself is wrong or
-- missing. An FK here would reject exactly the rows worth keeping.
--
-- payload_redacted is the only place workflow payloads land, so it must stay
-- redacted at the call site — this table is not an appropriate home for tokens
-- or message bodies.
create table if not exists public.dead_letter (
  id               uuid primary key default gen_random_uuid(),
  workflow         text,
  error            text,
  payload_redacted text,
  client_id        text,
  ts               timestamptz not null default now(),
  retry_count      int not null default 0,
  status           text not null default 'new',
  constraint dead_letter_status_chk check (status in ('new', 'retrying', 'resolved', 'abandoned'))
);

create index if not exists dead_letter_status_idx on public.dead_letter (status, ts desc);

-- ── 4. market_signals ───────────────────────────────────────────────────────
create table if not exists public.market_signals (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null references public.client_profile (client_id) on delete cascade,
  date        date not null,
  signal_text text,
  source      text,
  delivered   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists market_signals_client_date_idx
  on public.market_signals (client_id, date desc);

-- ── 4b. war_room_sessions — correction to 003 ───────────────────────────────
-- 003 modelled this table from the Inbound Router's read-only use of it, which
-- only ever touched committed_action. The War Room workflow's own upsertSession
-- node writes ten columns, so the rest are added here rather than by editing an
-- already-applied migration.
--
-- The upsert matches on session_id, which 003 already made unique — that is what
-- makes the multi-turn conversation state converge on one row per session.
alter table public.war_room_sessions add column if not exists session_date        date;
alter table public.war_room_sessions add column if not exists transcript_json     text;
alter table public.war_room_sessions add column if not exists session_type        text;
alter table public.war_room_sessions add column if not exists final_confidence    numeric;
alter table public.war_room_sessions add column if not exists low_confidence_flag boolean default false;
alter table public.war_room_sessions add column if not exists action_due_date     date;
alter table public.war_room_sessions add column if not exists focus_topic         text;

-- ── 5. Views absorbing Airtable DATETIME_DIFF filters ───────────────────────
-- The Supabase node's filter UI ANDs simple comparisons only, so relative-time
-- windows move here. Postgres evaluates these in UTC, which also removes the
-- timezone ambiguity Airtable's NOW() carried.
--
-- Each view keeps client_id so the node can still filter to one client with a
-- plain eq condition.

-- eodPro00001ghl.fetchTodayNudges:
--   AND({client_id}=…, DATETIME_DIFF(NOW(),{timestamp},'hours')<=18)
create or replace view public.v_nudges_recent_18h
with (security_invoker = on) as
select *
from public.nudges
where timestamp >= now() - interval '18 hours';

-- stageTrans01ghl.fetchScores:
--   AND({client_id}=…, DATETIME_DIFF(NOW(),{date},'days')<=7)
-- `date` is a date, not a timestamptz, so the bound is expressed in days.
create or replace view public.v_daily_scores_last_7d
with (security_invoker = on) as
select *
from public.daily_scores
where date >= (current_date - 7);

-- ── 5b. v_clients_match — War Room's inbound client lookup ──────────────────
-- warRoom0001.loadProfile builds its Airtable filter in JavaScript:
--   OR({phone_number}='<From>', AND({ghl_contact_id}!='', {ghl_contact_id}='<id>'))
-- The design doc flagged this as the one filter that might need a Postgres node
-- or RPC. It does not: the OR can be pushed into a view, and the node then
-- filters on a single generated column with a plain eq.
--
-- match_key explodes each client into the keys they can be recognised by, so one
-- client yields up to three rows: raw phone, digits-only phone, and GHL contact
-- id. GHL formats numbers inconsistently (+1 555…, 1555…, whatsapp: prefixes),
-- and phone-only matching is what previously misidentified a paying Pro client
-- as non-Pro. Matching on digits removes the formatting dependency entirely.
--
-- ghl_contact_id rows are only emitted when the id is non-empty, preserving the
-- AND({ghl_contact_id}!='', …) guard — without it every client with a NULL id
-- would collide on a single empty key.
create or replace view public.v_clients_match
with (security_invoker = on) as
select c.*, m.match_key
from public.v_clients c
cross join lateral (
  values
    (c.phone_number),
    (regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g')),
    (c.ghl_contact_id)
) as m(match_key)
where m.match_key is not null
  and m.match_key <> '';

-- ── 6. Row Level Security ───────────────────────────────────────────────────
-- Consistent with 001–003: n8n uses service_role and bypasses RLS; these
-- policies constrain the browser to the signed-in user's own rows.
alter table public.nudges          enable row level security;
alter table public.business_health enable row level security;
alter table public.market_signals  enable row level security;
alter table public.dead_letter     enable row level security;

drop policy if exists "nudges: own rows read" on public.nudges;
create policy "nudges: own rows read"
  on public.nudges for select
  using (client_id = public.current_client_id());

drop policy if exists "business_health: own rows read" on public.business_health;
create policy "business_health: own rows read"
  on public.business_health for select
  using (client_id = public.current_client_id());

drop policy if exists "market_signals: own rows read" on public.market_signals;
create policy "market_signals: own rows read"
  on public.market_signals for select
  using (client_id = public.current_client_id());

-- dead_letter deliberately gets NO browser-readable policy. It holds operational
-- failure detail across all clients and has no reliable client_id to scope by.
-- RLS on with no select policy means the browser sees nothing, which is intended;
-- n8n still reaches it via service_role.

-- ── 7. Verification ─────────────────────────────────────────────────────────
--   select * from public.nudges limit 1;                 -- expect 0 rows, HTTP 200
--   select * from public.v_nudges_recent_18h limit 1;    -- expect 0 rows, HTTP 200
--   select * from public.v_daily_scores_last_7d limit 1; -- expect 0 rows, HTTP 200
