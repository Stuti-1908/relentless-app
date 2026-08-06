-- ============================================================================
-- Relentless AI — Airtable → Supabase migration, Phase 3
-- Tables required by the GHL Inbound Router (ghlInboundV1) conversion.
--
-- The router is the highest-impact remaining workflow: it handles every inbound
-- client SMS reply. It has 9 Airtable nodes touching 5 tables. Three of those
-- (client_profile, pending_replies, biometrics) are covered by 001/002; the two
-- below are the remaining gap.
--
-- Run this ONCE in the Supabase SQL Editor, AFTER 002_schema_phase2.
-- Same Postgres 15+ requirement for `security_invoker` — see 001's header.
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ── 1. inbound_seen — idempotency guard ─────────────────────────────────────
-- The router's searchSeen/createSeen pair dedupes inbound webhooks: GHL can
-- redeliver the same message, and without this a client's single reply could be
-- parsed (and answered) twice.
--
-- message_sid carries a UNIQUE constraint rather than relying on the search
-- node alone. The search-then-create pattern is read-modify-write and races
-- under concurrent redelivery; the constraint is what actually guarantees
-- once-only processing.
create table if not exists public.inbound_seen (
  id          uuid primary key default gen_random_uuid(),
  message_sid text unique not null,
  kind        text,                      -- e.g. 'ghl_inbound'
  received_at timestamptz not null default now()
);

create index if not exists inbound_seen_received_idx
  on public.inbound_seen (received_at desc);

-- ── 2. war_room_sessions — Pro multi-turn coaching state ────────────────────
-- The router's loadWarRoom node reads open sessions, where "open" means
-- committed_action is empty. In Airtable that was the empty string; in Postgres
-- the honest representation is NULL, so v_open_war_room below treats both as
-- open and the workflow keeps working either way.
create table if not exists public.war_room_sessions (
  id               uuid primary key default gen_random_uuid(),
  session_id       text unique not null,
  client_id        text not null references public.client_profile (client_id) on delete cascade,
  ghl_contact_id   text,
  state            text,                 -- e.g. 'await_describe'
  branch           text,                 -- PROBLEM | OPPORTUNITY | STRATEGY
  transcript       text,
  committed_action text,                 -- NULL/'' = still open
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz
);

create index if not exists war_room_sessions_client_idx
  on public.war_room_sessions (client_id, opened_at desc);
create index if not exists war_room_sessions_open_idx
  on public.war_room_sessions (client_id)
  where committed_action is null or committed_action = '';

-- ── 3. v_open_war_room ──────────────────────────────────────────────────────
-- Absorbs the Airtable filter {committed_action}='' , which the Supabase node's
-- filter UI cannot express (it needs an OR across NULL and empty string).
-- Same pattern as v_open_pending_replies in 001.
create or replace view public.v_open_war_room
with (security_invoker = on) as
select *
from public.war_room_sessions
where committed_action is null or committed_action = '';

-- ── 4. Row Level Security ───────────────────────────────────────────────────
-- Consistent with 001/002: n8n uses service_role and bypasses RLS; these
-- policies constrain the browser to the signed-in user's own rows.
alter table public.inbound_seen       enable row level security;
alter table public.war_room_sessions  enable row level security;

drop policy if exists "war_room_sessions: own rows read" on public.war_room_sessions;
create policy "war_room_sessions: own rows read"
  on public.war_room_sessions for select
  using (client_id = public.current_client_id());

-- inbound_seen deliberately gets NO browser-readable policy. It is pure backend
-- plumbing keyed by provider message ids and has no client_id to scope by;
-- RLS-enabled with no select policy means the browser sees nothing, which is
-- the intent. n8n still reaches it via service_role.

-- ── 5. Verification ─────────────────────────────────────────────────────────
--   select * from public.inbound_seen limit 1;        -- expect 0 rows, HTTP 200
--   select * from public.v_open_war_room limit 1;     -- expect 0 rows, HTTP 200
