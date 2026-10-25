-- A sourced backfill is real data, separate from fictional development seeds.
-- One transaction imports each member's complete supplied chain in date order.
alter table public.app_settings add column historical_coverage jsonb;

-- INEC register: https://www.inecnigeria.org/parties/nigeria-democratic-congress
insert into public.parties (code, name, color) values ('NDC', 'Nigeria Democratic Congress', '#737373');

create or replace function public.seed_historical_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  leg public.legislators;
  imported_event_id uuid;
  article_id bigint;
  fp smallint;
  tp smallint;
  ep smallint;
  inserted integer := 0;
  skipped integer := 0;
begin
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') then
    raise exception 'seed_historical_events is for the service role only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'historical events must be a nonempty array';
  end if;

  -- Serialize backfill runs so concurrent imports cannot create two chains.
  perform pg_advisory_xact_lock(736451);
  for r in select value from jsonb_array_elements(p_events) order by value ->> 'event_date'
  loop
    if nullif(r ->> 'dedupe_key', '') is null
       or r ->> 'dedupe_key' not like 'historical:%'
       or coalesce(r ->> 'source_url', '') !~ '^https://'
       or coalesce(length(trim(r ->> 'evidence_quote')), 0) not between 5 and 300
       or (r ->> 'event_date')::date not between date '2023-06-13' and current_date
       or (r ->> 'event_date')::date < (r ->> 'term_start')::date
       or (r ->> 'verified_at')::date > current_date
       or r ->> 'from_party' = r ->> 'to_party' then
      raise exception 'invalid historical evidence or date for %', r ->> 'full_name';
    end if;
    if exists (select 1 from public.defection_events where dedupe_key = r ->> 'dedupe_key') then
      skipped := skipped + 1;
      continue;
    end if;
    select id into fp from public.parties where code = r ->> 'from_party';
    select id into tp from public.parties where code = r ->> 'to_party';
    select id into ep from public.parties where code = r ->> 'elected_party';
    if fp is null or tp is null or ep is null then
      raise exception 'unknown party for %', r ->> 'full_name';
    end if;
    select * into leg from public.legislators
    where not is_fictional and chamber = r ->> 'chamber' and state = r ->> 'state'
      and lower(constituency) = lower(r ->> 'constituency')
      and lower(full_name) = lower(r ->> 'full_name') for update;
    if not found then
      if fp <> ep then
        raise exception 'missing initial party history for %', r ->> 'full_name';
      end if;
      insert into public.legislators (
        full_name, chamber, state, constituency, elected_party_id, current_party_id,
        source_url, verified_at, is_fictional
      ) values (
        r ->> 'full_name', r ->> 'chamber', r ->> 'state', r ->> 'constituency', ep, fp,
        r ->> 'source_url', (r ->> 'verified_at')::timestamptz, false
      ) returning * into leg;
      insert into public.party_affiliations (legislator_id, party_id, start_date, source_url)
      values (leg.id, ep, (r ->> 'term_start')::date, r ->> 'source_url');
    end if;

    insert into public.articles (url, outlet, title, published_at, prefilter_hit, classification, processed_at)
    values (r ->> 'source_url', r ->> 'outlet', r ->> 'source_title',
      (r ->> 'published_at')::timestamptz, true, 'CONFIRMED_DEFECTION', now())
    on conflict (url) do update set url = excluded.url returning id into article_id;
    insert into public.defection_events (
      legislator_id, raw_name, from_party_id, to_party_id, event_type, event_date, announced_date,
      chamber, state, confidence, status, evidence_quote, reasoning_summary,
      model, prompt_version, dedupe_key
    ) values (
      leg.id, leg.full_name, fp, tp, 'CONFIRMED_DEFECTION', (r ->> 'event_date')::date, (r ->> 'announced_date')::date,
      leg.chamber, leg.state, 1, 'detected', r ->> 'evidence_quote',
      'Sourced historical backfill; manually researched, not an AI confidence estimate.',
      'historical-import', 'historical-v1', r ->> 'dedupe_key'
    ) returning id into imported_event_id;
    insert into public.event_sources (event_id, article_id, evidence_quote)
    values (imported_event_id, article_id, r ->> 'evidence_quote');
    perform public.publish_defection(imported_event_id);
    -- Backfilled alerts belong on their historical dates, not as breaking news today.
    update public.alerts a set created_at = (r ->> 'event_date')::date::timestamptz
    where a.event_id = imported_event_id and a.kind = 'published';
    inserted := inserted + 1;
  end loop;

  -- Former/deceased members were sitting at the time of their recorded moves.
  for r in select value from jsonb_array_elements(p_events) where value ->> 'status' <> 'sitting'
  loop
    if nullif(r ->> 'left_office_on', '') is null
      or (r ->> 'left_office_on')::date < (r ->> 'event_date')::date then
      raise exception 'invalid departure date for %', r ->> 'full_name';
    end if;
    select * into leg from public.legislators where not is_fictional
      and chamber = r ->> 'chamber' and state = r ->> 'state'
      and lower(constituency) = lower(r ->> 'constituency') and lower(full_name) = lower(r ->> 'full_name');
    update public.party_affiliations set end_date = (r ->> 'left_office_on')::date
    where legislator_id = leg.id and end_date is null;
    update public.legislators set status = r ->> 'status' where id = leg.id;
  end loop;
  update public.app_settings set demo_mode = false, historical_coverage = jsonb_build_object(
    'start', '2023-06-13', 'reviewed_through', (select max(value ->> 'verified_at') from jsonb_array_elements(p_events)),
    'latest_event', (select max(event_date) from public.defection_events where model = 'historical-import'),
    'complete', false
  ) where id;
  return jsonb_build_object('inserted', inserted, 'skipped', skipped);
end;
$$;

revoke execute on function public.seed_historical_events(jsonb) from public, anon, authenticated;
grant execute on function public.seed_historical_events(jsonb) to service_role;
