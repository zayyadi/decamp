-- Sourced state-assembly backfill (Milestone 9, phase 1; SPEC §3.1). Unlike the
-- federal backfill, these records are drafted into the review queue rather
-- than published: without a sourced assembly roster, an editor confirms each
-- member from the source before approving (the state_assembly hard gate).

-- The researched member details, shown to the editor to pre-fill "add member".
-- Admin-only: anon reads defection_events through column grants, which this
-- column is deliberately left out of.
alter table public.defection_events add column proposed_member jsonb;

-- Approving a backfilled event publishes it today, but its alert belongs on the
-- historical date, not at the top of the live feed.
create or replace function public.backdate_backfill_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  happened date;
begin
  select coalesce(e.event_date, e.announced_date) into happened
  from public.defection_events e
  where e.id = new.event_id and e.model = 'historical-import';
  if happened is not null then
    new.created_at := happened::timestamptz;
  end if;
  return new;
end;
$$;

revoke execute on function public.backdate_backfill_alert() from public, anon, authenticated;

create trigger alerts_backdate_backfill before insert on public.alerts
  for each row when (new.kind = 'published' and new.event_id is not null)
  execute function public.backdate_backfill_alert();

-- Re-runnable. Each run drafts events it hasn't seen, links open drafts to
-- members an editor has since added, and records departures (status other
-- than sitting) once the defection before them has been approved.
create or replace function public.draft_historical_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  existing public.defection_events;
  member_id uuid;
  article_id bigint;
  drafted_id uuid;
  fp smallint;
  tp smallint;
  ep smallint;
  drafted integer := 0;
  skipped integer := 0;
  linked integer := 0;
  departed integer := 0;
begin
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') then
    raise exception 'draft_historical_events is for the service role only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'historical events must be a nonempty array';
  end if;

  perform pg_advisory_xact_lock(736452);
  for r in select value from jsonb_array_elements(p_events) order by value ->> 'event_date'
  loop
    if r ->> 'chamber' is distinct from 'state_assembly' then
      raise exception 'only state-assembly events are drafted for review; % belongs in the federal backfill', r ->> 'full_name';
    end if;
    -- State assemblies were inaugurated on different days in early June 2023.
    if nullif(r ->> 'dedupe_key', '') is null
       or r ->> 'dedupe_key' not like 'historical:%'
       or coalesce(trim(r ->> 'full_name'), '') = ''
       or coalesce(trim(r ->> 'constituency'), '') = ''
       or coalesce(r ->> 'source_url', '') !~ '^https://'
       or coalesce(length(trim(r ->> 'evidence_quote')), 0) not between 5 and 300
       or (r ->> 'term_start')::date not between date '2023-06-01' and current_date
       or (r ->> 'event_date')::date not between (r ->> 'term_start')::date and current_date
       or (r ->> 'verified_at')::date > current_date
       or r ->> 'from_party' = r ->> 'to_party' then
      raise exception 'invalid historical evidence or date for %', r ->> 'full_name';
    end if;
    if not exists (select 1 from public.ng_states where name = r ->> 'state') or r ->> 'state' = 'FCT' then
      raise exception 'no House of Assembly in % for %', r ->> 'state', r ->> 'full_name';
    end if;
    select id into fp from public.parties where code = r ->> 'from_party';
    select id into tp from public.parties where code = r ->> 'to_party';
    select id into ep from public.parties where code = r ->> 'elected_party';
    if fp is null or tp is null or ep is null then
      raise exception 'unknown party for %', r ->> 'full_name';
    end if;

    member_id := null;
    select l.id into member_id from public.legislators l
    where not l.is_fictional and l.chamber = 'state_assembly' and l.status = 'sitting'
      and l.state = r ->> 'state'
      and lower(l.constituency) = lower(trim(r ->> 'constituency'))
      and lower(l.full_name) = lower(trim(r ->> 'full_name'));

    select * into existing from public.defection_events where dedupe_key = r ->> 'dedupe_key';
    if found then
      if existing.status in ('detected', 'in_review') and existing.legislator_id is null and member_id is not null then
        update public.defection_events set legislator_id = member_id where id = existing.id;
        linked := linked + 1;
      end if;
      skipped := skipped + 1;
      continue;
    end if;

    insert into public.articles (url, outlet, title, published_at, prefilter_hit, classification, processed_at)
    values (r ->> 'source_url', r ->> 'outlet', r ->> 'source_title',
      (r ->> 'published_at')::timestamptz, true, 'CONFIRMED_DEFECTION', now())
    on conflict (url) do update set url = excluded.url returning id into article_id;
    insert into public.defection_events (
      legislator_id, raw_name, from_party_id, to_party_id, event_type, event_date, announced_date,
      chamber, state, confidence, status, review_flags, evidence_quote, reasoning_summary,
      model, prompt_version, dedupe_key, proposed_member
    ) values (
      member_id, trim(r ->> 'full_name'), fp, tp, 'CONFIRMED_DEFECTION', (r ->> 'event_date')::date,
      (r ->> 'announced_date')::date, 'state_assembly', r ->> 'state', 1, 'in_review',
      array['historical_backfill'], r ->> 'evidence_quote',
      'Sourced historical backfill, drafted for review; manually researched, not an AI confidence estimate.',
      'historical-import', 'historical-v1', r ->> 'dedupe_key',
      jsonb_build_object(
        'full_name', trim(r ->> 'full_name'),
        'constituency', trim(r ->> 'constituency'),
        'elected_party', r ->> 'elected_party',
        'term_start', r ->> 'term_start',
        'source_url', r ->> 'source_url',
        'status', coalesce(r ->> 'status', 'sitting'),
        'left_office_on', r ->> 'left_office_on'
      )
    ) returning id into drafted_id;
    insert into public.event_sources (event_id, article_id, evidence_quote)
    values (drafted_id, article_id, r ->> 'evidence_quote');
    if member_id is not null then
      linked := linked + 1;
    end if;
    drafted := drafted + 1;
  end loop;

  -- A member who left office after an approved defection: close their seat.
  for r in select value from jsonb_array_elements(p_events)
    where coalesce(value ->> 'status', 'sitting') <> 'sitting'
  loop
    if r ->> 'status' not in ('former', 'deceased', 'vacated')
       or nullif(r ->> 'left_office_on', '') is null
       or (r ->> 'left_office_on')::date not between (r ->> 'event_date')::date and current_date then
      raise exception 'invalid departure date for %', r ->> 'full_name';
    end if;
    select e.legislator_id into member_id from public.defection_events e
    join public.legislators l on l.id = e.legislator_id
    where e.dedupe_key = r ->> 'dedupe_key' and e.status = 'published' and l.status = 'sitting';
    if found then
      update public.party_affiliations set end_date = (r ->> 'left_office_on')::date
      where legislator_id = member_id and end_date is null;
      update public.legislators set status = r ->> 'status' where id = member_id;
      departed := departed + 1;
    end if;
  end loop;

  return jsonb_build_object('drafted', drafted, 'skipped', skipped, 'linked', linked, 'departed', departed);
end;
$$;

revoke execute on function public.draft_historical_events(jsonb) from public, anon, authenticated;
grant execute on function public.draft_historical_events(jsonb) to service_role;
