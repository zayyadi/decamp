-- Dashboard (SPEC §6, Milestone 5): party colours and the aggregations behind
-- the overview page. Every function is SECURITY INVOKER, so the caller's RLS
-- decides which legislators and events are counted (fictional rows only in
-- demo mode), and each counts published events only, whoever calls it: counts
-- never include unverified events (CLAUDE.md rule 1).

-- Mid-tones with >= 3:1 contrast on the light and dark backgrounds; mirrored
-- in lib/parties.ts.
update public.parties p set color = c.color
from (values
  ('APC', '#3474bd'), ('PDP', '#d0413c'), ('LP', '#2f855a'), ('NNPP', '#805ad5'),
  ('APGA', '#b7791f'), ('SDP', '#d4661c'), ('ADC', '#0f8a7e'), ('YPP', '#8a7a0a'),
  ('ADP', '#d23a78'), ('PRP', '#64748b'), ('ZLP', '#a85ca6'), ('A', '#2c8a8a'),
  ('AA', '#8d6e63'), ('AAC', '#b9590f'), ('APM', '#5b7d8f'), ('APP', '#7c8a14'),
  ('BP', '#c4477f'), ('NRM', '#16809b')
) as c (code, color)
where p.code = c.code;

alter table public.parties
  add constraint parties_color_hex check (color is null or color ~ '^#[0-9a-f]{6}$');

-- Published defections matching the overview filters. `p_party` matches either
-- side of the move. An event is dated by when it happened, falling back to the
-- plenary reading and then to when it was recorded.
create or replace function public.dashboard_events(
  p_chamber text default null,
  p_party text default null,
  p_state text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  id uuid,
  legislator_id uuid,
  full_name text,
  chamber text,
  state text,
  constituency text,
  from_code text,
  to_code text,
  is_return boolean,
  effective_date date,
  confidence numeric
)
language sql
stable
set search_path = ''
as $$
  select e.id, l.id, l.full_name, l.chamber, l.state, l.constituency,
         fp.code, tp.code, e.is_return,
         coalesce(e.event_date, e.announced_date, e.created_at::date),
         e.confidence
  from public.defection_events e
  join public.legislators l on l.id = e.legislator_id
  left join public.parties fp on fp.id = e.from_party_id
  join public.parties tp on tp.id = e.to_party_id
  where e.status = 'published'
    and (p_chamber is null or l.chamber = p_chamber)
    and (p_state is null or l.state = p_state)
    and (p_party is null or fp.code = p_party or tp.code = p_party)
    and (p_from is null or coalesce(e.event_date, e.announced_date, e.created_at::date) >= p_from)
    and (p_to is null or coalesce(e.event_date, e.announced_date, e.created_at::date) <= p_to);
$$;

-- KPI cards. "Last 7 days" ignores the date range but keeps the other filters.
-- Net change counts +1 for the destination party and -1 for the origin.
create or replace function public.defection_kpis(
  p_chamber text default null,
  p_party text default null,
  p_state text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  total bigint,
  last_7_days bigint,
  top_gainer text,
  top_gainer_net bigint,
  top_loser text,
  top_loser_net bigint
)
language sql
stable
set search_path = ''
as $$
  with ev as (
    select * from public.dashboard_events(p_chamber, p_party, p_state, p_from, p_to)
  ),
  net as (
    select code, sum(delta)::bigint as n
    from (
      select to_code as code, 1 as delta from ev
      union all
      select from_code, -1 from ev where from_code is not null
    ) moves
    group by code
  )
  select
    (select count(*) from ev),
    (select count(*)
       from public.dashboard_events(p_chamber, p_party, p_state, current_date - 6, current_date)),
    g.code, g.n, l.code, l.n
  from (select 1) one
  left join lateral (select code, n from net where n > 0 order by n desc, code limit 1) g on true
  left join lateral (select code, n from net where n < 0 order by n, code limit 1) l on true;
$$;

-- Sankey links: moves from one party to another.
create or replace function public.party_flows(
  p_chamber text default null,
  p_party text default null,
  p_state text default null,
  p_from date default null,
  p_to date default null
)
returns table (from_code text, to_code text, defections bigint)
language sql
stable
set search_path = ''
as $$
  select from_code, to_code, count(*)
  from public.dashboard_events(p_chamber, p_party, p_state, p_from, p_to)
  where from_code is not null
  group by from_code, to_code
  order by count(*) desc, from_code, to_code;
$$;

-- Map: defections per state with the most common move there.
create or replace function public.defections_by_state(
  p_chamber text default null,
  p_party text default null,
  p_state text default null,
  p_from date default null,
  p_to date default null
)
returns table (state text, defections bigint, top_from text, top_to text, top_count bigint)
language sql
stable
set search_path = ''
as $$
  with flows as (
    select state, from_code, to_code, count(*) as n
    from public.dashboard_events(p_chamber, p_party, p_state, p_from, p_to)
    group by state, from_code, to_code
  ),
  ranked as (
    select *,
           sum(n) over (partition by state) as total,
           row_number() over (partition by state order by n desc, from_code, to_code) as rn
    from flows
  )
  select state, total, from_code, to_code, n
  from ranked
  where rn = 1
  order by total desc, state;
$$;

-- Timeline: defections per ISO week (Monday start), with empty weeks filled in
-- from the range start (or the first defection) to the range end (or today).
create or replace function public.defections_by_week(
  p_chamber text default null,
  p_party text default null,
  p_state text default null,
  p_from date default null,
  p_to date default null
)
returns table (week_start date, defections bigint)
language sql
stable
set search_path = ''
as $$
  with ev as (
    select date_trunc('week', effective_date)::date as week_start
    from public.dashboard_events(p_chamber, p_party, p_state, p_from, p_to)
  ),
  bounds as (
    select date_trunc('week', coalesce(p_from, (select min(week_start) from ev)))::date as lo,
           date_trunc('week', coalesce(p_to, current_date))::date as hi
  )
  select w::date, (select count(*) from ev where ev.week_start = w::date)
  from bounds, generate_series(bounds.lo, bounds.hi, interval '1 week') as w
  where bounds.lo is not null
  order by 1;
$$;

revoke execute on function
  public.dashboard_events(text, text, text, date, date),
  public.defection_kpis(text, text, text, date, date),
  public.party_flows(text, text, text, date, date),
  public.defections_by_state(text, text, text, date, date),
  public.defections_by_week(text, text, text, date, date)
  from public;
grant execute on function
  public.dashboard_events(text, text, text, date, date),
  public.defection_kpis(text, text, text, date, date),
  public.party_flows(text, text, text, date, date),
  public.defections_by_state(text, text, text, date, date),
  public.defections_by_week(text, text, text, date, date)
  to anon, authenticated, service_role;
