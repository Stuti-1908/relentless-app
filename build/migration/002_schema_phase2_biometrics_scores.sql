-- ============================================================================
-- Relentless AI — Airtable → Supabase migration, Phase 2 (partial)
-- biometrics + daily_scores only — pulled forward from the original Phase 2
-- scope because briefBuilder1's loadBiometrics node hard-fails the entire
-- briefing workflow when Airtable is unreachable (its try/catch in buildBriefing
-- only covers an EMPTY result, not a failed HTTP call — the workflow never
-- reaches that code when the node itself errors).
--
-- Run this ONCE in the Supabase SQL Editor, same as 001_schema_phase1.sql.
-- Same Postgres 15+ requirement for `security_invoker` — see 001's header.
-- ============================================================================

create table if not exists public.biometrics (
  id                   uuid primary key default gen_random_uuid(),
  client_id            text not null references public.client_profile (client_id) on delete cascade,
  date                 date not null,
  source               text,                     -- e.g. 'manual', 'whoop', 'oura'
  recovery_score       numeric,
  manual_sleep_input   numeric,
  manual_energy_input  numeric,
  manual_stress_input  numeric,
  created_at           timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists biometrics_client_date_idx on public.biometrics (client_id, date desc);

create table if not exists public.daily_scores (
  id                 uuid primary key default gen_random_uuid(),
  client_id          text not null references public.client_profile (client_id) on delete cascade,
  date               date not null,
  body_score         numeric,
  focus_score        numeric,
  execution_score    numeric,
  alignment_score    numeric,
  composite_score    numeric,
  score_label        text,
  biometric_missing  boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (client_id, date)
);
create index if not exists daily_scores_client_date_idx on public.daily_scores (client_id, date desc);

alter table public.biometrics   enable row level security;
alter table public.daily_scores enable row level security;

drop policy if exists "biometrics: own rows read" on public.biometrics;
create policy "biometrics: own rows read"
  on public.biometrics for select
  using (client_id = public.current_client_id());

drop policy if exists "daily_scores: own rows read" on public.daily_scores;
create policy "daily_scores: own rows read"
  on public.daily_scores for select
  using (client_id = public.current_client_id());

-- Verification: both should return 0 rows (empty, newly created) with HTTP 200.
--   select * from public.biometrics limit 1;
--   select * from public.daily_scores limit 1;
