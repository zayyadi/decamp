-- State Houses of Assembly (Milestone 9, phase 1; SPEC §3.1). Members of the
-- 36 state assemblies become a third chamber. Their defections have their own
-- section; national views keep counting the two federal chambers only. The
-- assembly roster grows through review (review_add_member) until full sourced
-- rosters exist (phase 2).

alter table public.legislators drop constraint legislators_chamber_check;
alter table public.legislators
  add constraint legislators_chamber_check check (chamber in ('senate', 'house', 'state_assembly'));
-- The FCT has Area Councils, not a House of Assembly.
alter table public.legislators
  add constraint legislators_assembly_state check (chamber <> 'state_assembly' or state <> 'FCT');

alter table public.defection_events drop constraint defection_events_chamber_check;
alter table public.defection_events
  add constraint defection_events_chamber_check check (chamber in ('senate', 'house', 'state_assembly'));

-- Same as 20261024000002 except the alert title: a state-assembly member's
-- location names the assembly, so the public feed can't mistake them for a
-- National Assembly member.
create or replace function public.publish_defection(p_event_id uuid)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  l public.legislators;
  open_aff public.party_affiliations;
  effective date;
  from_code text;
  to_code text;
  source_count integer;
  reviewer uuid;
begin
  perform public.assert_can_publish();

  select * into e from public.defection_events where id = p_event_id for update;
  if not found then
    raise exception 'defection event % not found', p_event_id using errcode = 'P0002';
  end if;

  if e.status = 'published' then
    return e;
  end if;
  if e.status not in ('detected', 'in_review') then
    raise exception 'cannot publish an event with status %', e.status;
  end if;
  if e.legislator_id is null then
    raise exception 'cannot publish: legislator is unresolved';
  end if;
  if e.to_party_id is null then
    raise exception 'cannot publish: destination party is unknown';
  end if;

  select * into l from public.legislators where id = e.legislator_id for update;
  if l.status <> 'sitting' then
    raise exception 'cannot publish: legislator status is %', l.status;
  end if;
  if e.to_party_id = l.current_party_id then
    raise exception 'cannot publish: legislator is already in the destination party';
  end if;
  if e.from_party_id is not null and e.from_party_id <> l.current_party_id then
    raise exception 'cannot publish: from_party does not match the legislator''s current party (stale roster or an unrecorded defection)';
  end if;

  effective := coalesce(e.event_date, e.announced_date, current_date);

  select * into open_aff from public.party_affiliations
  where legislator_id = l.id and end_date is null
  for update;
  if found then
    if effective < open_aff.start_date then
      raise exception 'cannot publish: event date % precedes the current affiliation start %',
        effective, open_aff.start_date;
    end if;
    update public.party_affiliations set end_date = effective where id = open_aff.id;
  end if;

  insert into public.party_affiliations (legislator_id, party_id, start_date, defection_event_id)
  values (l.id, e.to_party_id, effective, e.id);

  update public.legislators set current_party_id = e.to_party_id where id = l.id;

  if coalesce(current_setting('role', true), 'none') = 'authenticated' then
    reviewer := nullif(auth.jwt() ->> 'sub', '')::uuid;
  end if;

  update public.defection_events
  set status = 'published',
      reviewed_by = coalesce(reviewer, reviewed_by),
      reviewed_at = case when reviewer is not null then now() else reviewed_at end
  where id = e.id
  returning * into e;

  select code into from_code from public.parties where id = l.current_party_id;
  select code into to_code from public.parties where id = e.to_party_id;
  select count(*) into source_count from public.event_sources where event_id = e.id;

  insert into public.alerts (event_id, kind, level, title, body, is_fictional, dedupe_key)
  values (
    e.id,
    'published',
    'confirmed',
    format(
      '%s %s (%s, %s) %s',
      case l.chamber when 'senate' then 'Sen.' else 'Hon.' end,
      l.full_name, l.constituency,
      case when l.chamber = 'state_assembly' then l.state || ' State House of Assembly' else l.state end,
      case when e.is_return
        then format('returns to %s from %s', to_code, from_code)
        else format('defects from %s to %s', from_code, to_code)
      end
    ),
    format(
      '%s %s source%s.',
      case when reviewer is not null then 'Approved by an editor after review.' else 'Confirmed.' end,
      source_count,
      case when source_count = 1 then '' else 's' end
    ),
    l.is_fictional,
    format('event:%s:published', e.id)
  )
  on conflict (dedupe_key) do nothing;

  return e;
end;
$$;

-- No chamber means the National Assembly: state-assembly events appear only
-- when asked for, so national counts, flows, map and timeline stay federal.
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
    and (case when p_chamber is null then l.chamber in ('senate', 'house') else l.chamber = p_chamber end)
    and (p_state is null or l.state = p_state)
    and (p_party is null or fp.code = p_party or tp.code = p_party)
    and (p_from is null or coalesce(e.event_date, e.announced_date, e.created_at::date) >= p_from)
    and (p_to is null or coalesce(e.event_date, e.announced_date, e.created_at::date) <= p_to);
$$;

-- An editor confirming a state-assembly defection by a member not yet on the
-- roster adds them here, with the source that identifies them. The member's
-- party before this defection becomes their current party; the event is then
-- linked and can be approved through review_approve as usual.
create or replace function public.review_add_member(
  p_event_id uuid,
  p_full_name text,
  p_state text,
  p_constituency text,
  p_elected_party text,
  p_term_start date,
  p_source_url text
)
returns public.legislators
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  leg public.legislators;
  before jsonb;
  elected smallint;
  current_id smallint;
begin
  e := public.review_lock(p_event_id);
  if e.legislator_id is not null then
    raise exception 'this event is already linked to a member';
  end if;
  if coalesce(e.chamber, 'state_assembly') <> 'state_assembly' then
    raise exception 'only state-assembly members can be added during review; National Assembly members come from the sourced roster';
  end if;
  if coalesce(trim(p_full_name), '') = '' or coalesce(trim(p_constituency), '') = '' then
    raise exception 'the member''s name and state constituency are required';
  end if;
  if coalesce(p_source_url, '') !~ '^https://' then
    raise exception 'a source URL (https) identifying the member is required';
  end if;
  if p_term_start is null or p_term_start < date '2023-06-01' or p_term_start > current_date then
    raise exception 'term start must be between 2023-06-01 and today';
  end if;
  select id into elected from public.parties where code = p_elected_party;
  if elected is null then
    raise exception 'unknown party %', coalesce(p_elected_party, '(none)');
  end if;
  current_id := coalesce(e.from_party_id, elected);

  before := public.review_snapshot(e);
  begin
    insert into public.legislators (
      full_name, chamber, state, constituency, elected_party_id, current_party_id,
      status, source_url, verified_at, is_fictional
    )
    values (
      trim(p_full_name), 'state_assembly', p_state, trim(p_constituency), elected, current_id,
      'sitting', p_source_url, now(), false
    )
    returning * into leg;
  exception when unique_violation then
    raise exception 'a sitting member already holds % in %; link the event to them instead', trim(p_constituency), p_state;
  end;

  -- Only the current affiliation is known; earlier moves aren't invented.
  insert into public.party_affiliations (legislator_id, party_id, start_date, source_url)
  values (leg.id, current_id, p_term_start, p_source_url);

  update public.defection_events
  set legislator_id = leg.id, chamber = 'state_assembly', state = p_state
  where id = p_event_id
  returning * into e;
  insert into public.review_feedback (event_id, action, before, after, reviewer)
  values (
    p_event_id, 'edit', before,
    public.review_snapshot(e) || jsonb_build_object('added_member', leg.id, 'member_source', p_source_url),
    public.review_actor()
  );
  return leg;
end;
$$;

revoke execute on function public.review_add_member(uuid, text, text, text, text, date, text) from public, anon;
grant execute on function public.review_add_member(uuid, text, text, text, text, date, text) to authenticated, service_role;
