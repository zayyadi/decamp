-- DecampWatch NG: core schema (docs/SPEC.md §4).
-- Every table has RLS enabled and its policies defined here. anon and
-- authenticated never write directly: writes go through the service role or
-- SECURITY DEFINER functions (see the next migrations).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference data: states and parties live in migrations, not seeds, so every
-- environment has them after `db push`.
-- ---------------------------------------------------------------------------

create table public.ng_states (
  name text primary key,
  zone text not null check (zone in (
    'North Central', 'North East', 'North West',
    'South East', 'South South', 'South West'
  )),
  senate_seats smallint not null check (senate_seats in (1, 3))
);

insert into public.ng_states (name, zone, senate_seats) values
  ('Abia', 'South East', 3), ('Adamawa', 'North East', 3),
  ('Akwa Ibom', 'South South', 3), ('Anambra', 'South East', 3),
  ('Bauchi', 'North East', 3), ('Bayelsa', 'South South', 3),
  ('Benue', 'North Central', 3), ('Borno', 'North East', 3),
  ('Cross River', 'South South', 3), ('Delta', 'South South', 3),
  ('Ebonyi', 'South East', 3), ('Edo', 'South South', 3),
  ('Ekiti', 'South West', 3), ('Enugu', 'South East', 3),
  ('Gombe', 'North East', 3), ('Imo', 'South East', 3),
  ('Jigawa', 'North West', 3), ('Kaduna', 'North West', 3),
  ('Kano', 'North West', 3), ('Katsina', 'North West', 3),
  ('Kebbi', 'North West', 3), ('Kogi', 'North Central', 3),
  ('Kwara', 'North Central', 3), ('Lagos', 'South West', 3),
  ('Nasarawa', 'North Central', 3), ('Niger', 'North Central', 3),
  ('Ogun', 'South West', 3), ('Ondo', 'South West', 3),
  ('Osun', 'South West', 3), ('Oyo', 'South West', 3),
  ('Plateau', 'North Central', 3), ('Rivers', 'South South', 3),
  ('Sokoto', 'North West', 3), ('Taraba', 'North East', 3),
  ('Yobe', 'North East', 3), ('Zamfara', 'North West', 3),
  ('FCT', 'North Central', 1);

alter table public.ng_states enable row level security;
create policy "states are public" on public.ng_states
  for select to anon, authenticated using (true);

-- Parties that fielded candidates in the 2023 general elections. Verify
-- against INEC's current register before launch; add newly registered
-- parties in a new migration. Colours are assigned in Milestone 5.
create table public.parties (
  id smallint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z]{1,8}$'),
  name text not null unique,
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  aliases text[] not null default '{}'
);

insert into public.parties (code, name, aliases) values
  ('A', 'Accord', '{"Accord Party"}'),
  ('AA', 'Action Alliance', '{}'),
  ('AAC', 'African Action Congress', '{}'),
  ('ADC', 'African Democratic Congress', '{}'),
  ('ADP', 'Action Democratic Party', '{}'),
  ('APC', 'All Progressives Congress', '{}'),
  ('APGA', 'All Progressives Grand Alliance', '{}'),
  ('APM', 'Allied Peoples Movement', '{}'),
  ('APP', 'Action Peoples Party', '{}'),
  ('BP', 'Boot Party', '{}'),
  ('LP', 'Labour Party', '{}'),
  ('NNPP', 'New Nigeria Peoples Party', '{}'),
  ('NRM', 'National Rescue Movement', '{}'),
  ('PDP', 'Peoples Democratic Party', '{}'),
  ('PRP', 'Peoples Redemption Party', '{}'),
  ('SDP', 'Social Democratic Party', '{}'),
  ('YPP', 'Young Progressives Party', '{}'),
  ('ZLP', 'Zenith Labour Party', '{}');

alter table public.parties enable row level security;
create policy "parties are public" on public.parties
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- App settings (single row)
-- ---------------------------------------------------------------------------

create table public.app_settings (
  id boolean primary key default true check (id),
  -- When true, rows flagged is_fictional are visible to the public. Local
  -- demos only; must be false in production (SPEC.md §11).
  demo_mode boolean not null default false
);
insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;
create policy "settings are public" on public.app_settings
  for select to anon, authenticated using (true);

create or replace function public.demo_mode()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select demo_mode from public.app_settings where id), false);
$$;

-- ---------------------------------------------------------------------------
-- Legislators and party history
-- ---------------------------------------------------------------------------

create table public.legislators (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) >= 2),
  name_variants text[] not null default '{}',
  chamber text not null check (chamber in ('senate', 'house')),
  state text not null references public.ng_states (name),
  constituency text not null,
  elected_party_id smallint not null references public.parties (id),
  current_party_id smallint not null references public.parties (id),
  status text not null default 'sitting'
    check (status in ('sitting', 'former', 'deceased', 'vacated')),
  photo_url text,
  source_url text,
  verified_at timestamptz,
  is_fictional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Real rows must be traceable to where they were verified (SPEC.md §9).
  constraint legislators_real_rows_sourced
    check (is_fictional or (source_url is not null and verified_at is not null))
);

-- One sitting member per seat. Fictional rows are kept apart so a demo roster
-- can coexist with the real one in a dev database.
create unique index legislators_one_sitting_per_seat
  on public.legislators (chamber, state, lower(constituency), is_fictional)
  where status = 'sitting';
create unique index legislators_natural_key
  on public.legislators (chamber, state, lower(constituency), lower(full_name), is_fictional);

create trigger legislators_updated_at before update on public.legislators
  for each row execute function public.set_updated_at();

alter table public.legislators enable row level security;
create policy "real legislators are public; fictional only in demo mode"
  on public.legislators for select to anon, authenticated
  using (not is_fictional or public.demo_mode());

create table public.party_affiliations (
  id bigint generated always as identity primary key,
  legislator_id uuid not null references public.legislators (id) on delete cascade,
  party_id smallint not null references public.parties (id),
  -- [start_date, end_date): the day a defection takes effect belongs to the
  -- new party.
  start_date date not null,
  end_date date,
  defection_event_id uuid,
  -- Seeded history has no event; it must cite its own source.
  source_url text,
  constraint party_affiliations_dates check (end_date is null or end_date >= start_date)
);

create unique index party_affiliations_one_open
  on public.party_affiliations (legislator_id) where end_date is null;
create index party_affiliations_legislator on public.party_affiliations (legislator_id, start_date);

alter table public.party_affiliations enable row level security;
-- The subquery runs under the caller's RLS on legislators, so fictional
-- history hides with fictional legislators.
create policy "affiliations follow legislator visibility"
  on public.party_affiliations for select to anon, authenticated
  using (exists (select 1 from public.legislators l where l.id = legislator_id));

-- ---------------------------------------------------------------------------
-- Agent runs and articles
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  feeds_ok integer not null default 0,
  feeds_failed integer not null default 0,
  articles_new integer not null default 0,
  articles_prefiltered integer not null default 0,
  llm_calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  events_created integer not null default 0,
  events_published integer not null default 0,
  errors jsonb not null default '[]'
);

alter table public.agent_runs enable row level security;
create policy "admins read runs" on public.agent_runs
  for select to authenticated using (public.is_admin());

create table public.articles (
  id bigint generated always as identity primary key,
  url text not null unique,
  outlet text not null,
  title text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  -- Internal only: never granted to anon or authenticated (CLAUDE.md rule 5).
  content text,
  content_hash text,
  prefilter_hit boolean not null default false,
  classification text,
  processed_at timestamptz,
  run_id bigint references public.agent_runs (id)
);

create index articles_content_hash on public.articles (content_hash);
create index articles_published_at on public.articles (published_at desc);

alter table public.articles enable row level security;

-- ---------------------------------------------------------------------------
-- Defection events, sources, alerts
-- ---------------------------------------------------------------------------

create table public.defection_events (
  id uuid primary key default gen_random_uuid(),
  legislator_id uuid references public.legislators (id),
  raw_name text not null,
  from_party_id smallint references public.parties (id),
  to_party_id smallint references public.parties (id),
  event_type text not null check (event_type in (
    'CONFIRMED_DEFECTION', 'FORMAL_PLENARY_ANNOUNCEMENT', 'GROUP_DEFECTION'
  )),
  is_return boolean not null default false,
  event_date date,
  announced_date date,
  chamber text check (chamber in ('senate', 'house')),
  state text references public.ng_states (name),
  reason_given text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  score_breakdown jsonb not null default '{}',
  status text not null default 'detected' check (status in (
    'detected', 'in_review', 'published', 'rejected', 'reversed'
  )),
  review_flags text[] not null default '{}',
  evidence_quote text not null check (length(evidence_quote) <= 300),
  reasoning_summary text,
  model text,
  prompt_version text,
  -- Set by the agent from (origin article, legislator or normalised name) so
  -- re-processing an article can never create a second event.
  dedupe_key text not null unique,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint defection_events_published_resolved check (
    status not in ('published', 'reversed')
    or (legislator_id is not null and to_party_id is not null)
  )
);

create index defection_events_status on public.defection_events (status, created_at desc);
create index defection_events_legislator on public.defection_events (legislator_id, event_date);

create trigger defection_events_updated_at before update on public.defection_events
  for each row execute function public.set_updated_at();

alter table public.party_affiliations
  add constraint party_affiliations_event_fk
  foreign key (defection_event_id) references public.defection_events (id);

alter table public.defection_events enable row level security;
create policy "published events are public; admins see all"
  on public.defection_events for select to anon, authenticated
  using (
    public.is_admin()
    or (
      status = 'published'
      and exists (select 1 from public.legislators l where l.id = legislator_id)
    )
  );

create table public.event_sources (
  event_id uuid not null references public.defection_events (id) on delete cascade,
  article_id bigint not null references public.articles (id),
  evidence_quote text not null check (length(evidence_quote) <= 300),
  primary key (event_id, article_id)
);

alter table public.event_sources enable row level security;
create policy "sources follow event visibility"
  on public.event_sources for select to anon, authenticated
  using (exists (select 1 from public.defection_events e where e.id = event_id));

-- Article metadata is public only when it backs a visible event.
create policy "articles backing visible events; admins see all"
  on public.articles for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.event_sources es
      join public.defection_events e on e.id = es.event_id
      where es.article_id = articles.id
    )
  );

create table public.alerts (
  id bigint generated always as identity primary key,
  -- Null for group-level "developing" alerts with no single event.
  event_id uuid references public.defection_events (id),
  kind text not null check (kind in ('published', 'developing', 'correction', 'group_developing')),
  level text not null check (level in ('confirmed', 'unverified')),
  title text not null,
  body text not null,
  is_fictional boolean not null default false,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create index alerts_created_at on public.alerts (created_at desc);

alter table public.alerts enable row level security;
create policy "real alerts are public; fictional only in demo mode"
  on public.alerts for select to anon, authenticated
  using (not is_fictional or public.demo_mode());

create table public.review_feedback (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.defection_events (id),
  action text not null check (action in ('approve', 'edit', 'reject', 'merge')),
  reason_code text check (reason_code in (
    'rumour', 'denied', 'wrong_person', 'not_legislator', 'duplicate', 'other'
  )),
  before jsonb not null,
  after jsonb,
  reviewer uuid,
  created_at timestamptz not null default now()
);

alter table public.review_feedback enable row level security;
create policy "admins read feedback" on public.review_feedback
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants ALL on new tables to anon and authenticated by
-- default; TRUNCATE is not covered by RLS, so strip everything and grant back
-- only what the policies above are meant to allow.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
-- Tables created by later migrations start with no anon/authenticated access;
-- each migration grants exactly what its policies need.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on
  public.ng_states, public.parties, public.app_settings, public.legislators,
  public.party_affiliations, public.event_sources, public.alerts
  to anon, authenticated;

grant select (
  id, legislator_id, raw_name, from_party_id, to_party_id, event_type,
  is_return, event_date, announced_date, chamber, state, reason_given,
  confidence, score_breakdown, status, evidence_quote, reasoning_summary,
  model, prompt_version, created_at, updated_at
) on public.defection_events to anon;
grant select on public.defection_events to authenticated;

grant select (id, url, outlet, title, published_at) on public.articles to anon;
grant select (
  id, url, outlet, title, published_at, fetched_at, content_hash,
  prefilter_hit, classification, processed_at, run_id
) on public.articles to authenticated;

grant select on public.agent_runs, public.review_feedback to authenticated;

grant all on all tables in schema public to service_role;
