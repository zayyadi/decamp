-- Functions that change party membership (SPEC.md §4.2). Party counts change
-- only through publish_defection / reverse_defection (CLAUDE.md rule 1).

-- Callers: the service role (agent, scripts), an admin user, or a direct
-- database session (migrations, SQL editor). current_setting('role') is the
-- caller's role even inside SECURITY DEFINER functions.
create or replace function public.assert_can_publish()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  caller text := coalesce(current_setting('role', true), 'none');
begin
  if caller in ('service_role', 'none') then
    return;
  end if;
  if caller = 'authenticated' and public.is_admin() then
    return;
  end if;
  raise exception 'not authorised to change party membership'
    using errcode = '42501';
end;
$$;

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
      l.full_name, l.constituency, l.state,
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

create or replace function public.reverse_defection(p_event_id uuid, p_note text)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  l public.legislators;
  event_aff public.party_affiliations;
  prev_aff public.party_affiliations;
begin
  perform public.assert_can_publish();

  if coalesce(trim(p_note), '') = '' then
    raise exception 'a correction note is required';
  end if;

  select * into e from public.defection_events where id = p_event_id for update;
  if not found then
    raise exception 'defection event % not found', p_event_id using errcode = 'P0002';
  end if;
  if e.status <> 'published' then
    raise exception 'only published events can be reversed (status is %)', e.status;
  end if;

  select * into l from public.legislators where id = e.legislator_id for update;

  select * into event_aff from public.party_affiliations
  where defection_event_id = e.id and end_date is null;
  if not found then
    raise exception 'only the most recent defection of a legislator can be reversed';
  end if;

  delete from public.party_affiliations where id = event_aff.id;

  select * into prev_aff from public.party_affiliations
  where legislator_id = l.id
  order by start_date desc, id desc
  limit 1
  for update;
  if not found then
    raise exception 'no earlier affiliation to restore for legislator %', l.id;
  end if;

  update public.party_affiliations set end_date = null where id = prev_aff.id;
  update public.legislators set current_party_id = prev_aff.party_id where id = l.id;

  update public.defection_events
  set status = 'reversed',
      review_note = p_note,
      reviewed_at = now(),
      reviewed_by = case
        when coalesce(current_setting('role', true), 'none') = 'authenticated'
          then nullif(auth.jwt() ->> 'sub', '')::uuid
        else reviewed_by
      end
  where id = e.id
  returning * into e;

  insert into public.alerts (event_id, kind, level, title, body, is_fictional, dedupe_key)
  values (
    e.id,
    'correction',
    'confirmed',
    format('Correction: %s %s defection record withdrawn',
      case l.chamber when 'senate' then 'Sen.' else 'Hon.' end, l.full_name),
    p_note,
    l.is_fictional,
    format('event:%s:correction', e.id)
  )
  on conflict (dedupe_key) do nothing;

  return e;
end;
$$;

-- Seats per party at a date, from affiliation history. SECURITY INVOKER, so
-- fictional rows are counted only where the caller can see them.
create or replace function public.party_strength(
  p_chamber text default null,
  p_as_of date default current_date
)
returns table (party_id smallint, code text, name text, color text, seats bigint)
language sql
stable
set search_path = ''
as $$
  select p.id, p.code, p.name, p.color, count(*) as seats
  from public.party_affiliations pa
  join public.legislators l on l.id = pa.legislator_id
  join public.parties p on p.id = pa.party_id
  where pa.start_date <= p_as_of
    and (pa.end_date is null or pa.end_date > p_as_of)
    and (p_chamber is null or l.chamber = p_chamber)
  group by p.id, p.code, p.name, p.color
  order by seats desc, p.code;
$$;

revoke execute on function
  public.assert_can_publish(),
  public.publish_defection(uuid),
  public.reverse_defection(uuid, text)
  from public, anon;
grant execute on function
  public.assert_can_publish(),
  public.publish_defection(uuid),
  public.reverse_defection(uuid, text)
  to authenticated, service_role;
grant execute on function public.party_strength(text, date) to anon, authenticated, service_role;
grant execute on function public.is_admin(), public.demo_mode() to anon, authenticated, service_role;
