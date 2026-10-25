-- Roster seeding (SPEC.md §9), called by scripts/seed-roster.ts with rows the
-- script has already validated. One call is one transaction: a bad row rolls
-- back the whole file.
--
-- Re-running is safe. Rows match on (chamber, state, constituency, full_name,
-- is_fictional); matches update metadata only. Party changes after the first
-- seed must go through the defection pipeline, so a differing current_party is
-- reported as a warning, not applied.

create or replace function public.seed_roster(p_rows jsonb, p_fictional boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := coalesce(current_setting('role', true), 'none');
  r jsonb;
  row_no integer;
  elected_id smallint;
  current_id smallint;
  term_start date;
  since date;
  left_on date;
  new_status text;
  existing public.legislators;
  new_id uuid;
  inserted integer := 0;
  updated integer := 0;
  warnings text[] := '{}';
  over record;
begin
  if caller not in ('service_role', 'none') then
    raise exception 'seed_roster is restricted to the service role' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for r, row_no in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    select id into elected_id from public.parties where code = r ->> 'elected_party';
    if elected_id is null then
      raise exception 'row %: unknown elected_party "%"', row_no, r ->> 'elected_party';
    end if;
    select id into current_id from public.parties where code = r ->> 'current_party';
    if current_id is null then
      raise exception 'row %: unknown current_party "%"', row_no, r ->> 'current_party';
    end if;
    if not exists (select 1 from public.ng_states where name = r ->> 'state') then
      raise exception 'row %: unknown state "%"', row_no, r ->> 'state';
    end if;

    -- 10th National Assembly inauguration.
    term_start := coalesce((r ->> 'term_start')::date, date '2023-06-13');
    since := (r ->> 'current_party_since')::date;
    left_on := (r ->> 'left_office_on')::date;
    new_status := coalesce(r ->> 'status', 'sitting');

    if new_status <> 'sitting' and left_on is null then
      raise exception 'row %: left_office_on is required when status is %', row_no, new_status;
    end if;
    if current_id <> elected_id and (since is null or nullif(r ->> 'current_party_source_url', '') is null) then
      raise exception 'row %: current_party differs from elected_party, so current_party_since and current_party_source_url are required', row_no;
    end if;

    select * into existing from public.legislators
    where chamber = r ->> 'chamber'
      and state = r ->> 'state'
      and lower(constituency) = lower(r ->> 'constituency')
      and lower(full_name) = lower(r ->> 'full_name')
      and is_fictional = p_fictional;

    if found then
      if existing.status = 'sitting' and new_status <> 'sitting' then
        update public.party_affiliations set end_date = left_on
        where legislator_id = existing.id and end_date is null;
      elsif existing.status <> 'sitting' and new_status = 'sitting' then
        raise exception 'row %: % is % in the database; reinstating via the seed is not supported',
          row_no, existing.full_name, existing.status;
      end if;

      update public.legislators set
        name_variants = coalesce(array(select jsonb_array_elements_text(r -> 'name_variants')), '{}'),
        photo_url = nullif(r ->> 'photo_url', ''),
        source_url = nullif(r ->> 'source_url', ''),
        verified_at = (r ->> 'verified_at')::timestamptz,
        status = new_status
      where id = existing.id;

      if existing.current_party_id <> current_id then
        warnings := warnings || format(
          'row %s: %s is %s in the database but %s in the file; not changed (record defections through the pipeline)',
          row_no, existing.full_name,
          (select code from public.parties where id = existing.current_party_id),
          r ->> 'current_party');
      end if;
      updated := updated + 1;
      continue;
    end if;

    begin
      insert into public.legislators (
        full_name, name_variants, chamber, state, constituency,
        elected_party_id, current_party_id, status, photo_url, source_url,
        verified_at, is_fictional
      ) values (
        trim(r ->> 'full_name'),
        coalesce(array(select jsonb_array_elements_text(r -> 'name_variants')), '{}'),
        r ->> 'chamber',
        r ->> 'state',
        trim(r ->> 'constituency'),
        elected_id,
        current_id,
        new_status,
        nullif(r ->> 'photo_url', ''),
        nullif(r ->> 'source_url', ''),
        (r ->> 'verified_at')::timestamptz,
        p_fictional
      )
      returning id into new_id;
    exception
      when unique_violation then
        raise exception 'row %: another sitting member already holds % (%, %). Mark the previous holder as former/vacated first',
          row_no, r ->> 'constituency', r ->> 'chamber', r ->> 'state';
      when check_violation then
        raise exception 'row %: %', row_no, sqlerrm;
    end;

    if current_id <> elected_id then
      insert into public.party_affiliations (legislator_id, party_id, start_date, end_date)
      values (new_id, elected_id, term_start, since);
      insert into public.party_affiliations (legislator_id, party_id, start_date, end_date, source_url)
      values (new_id, current_id, since, left_on, r ->> 'current_party_source_url');
    else
      insert into public.party_affiliations (legislator_id, party_id, start_date, end_date)
      values (new_id, elected_id, term_start, left_on);
    end if;

    inserted := inserted + 1;
  end loop;

  for over in
    select s.name, l.is_fictional, count(*) as n, s.senate_seats
    from public.legislators l
    join public.ng_states s on s.name = l.state
    where l.chamber = 'senate' and l.status = 'sitting'
    group by s.name, l.is_fictional, s.senate_seats
    having count(*) > s.senate_seats
  loop
    raise exception '% has % sitting senators (max %)', over.name, over.n, over.senate_seats;
  end loop;

  for over in
    select l.chamber, l.is_fictional, count(*) as n
    from public.legislators l
    where l.status = 'sitting'
    group by l.chamber, l.is_fictional
    having count(*) > case l.chamber when 'senate' then 109 else 360 end
  loop
    raise exception 'too many sitting % members: %', over.chamber, over.n;
  end loop;

  return jsonb_build_object('inserted', inserted, 'updated', updated, 'warnings', to_jsonb(warnings));
end;
$$;

revoke execute on function public.seed_roster(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.seed_roster(jsonb, boolean) to service_role;

create or replace function public.set_demo_mode(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') then
    raise exception 'set_demo_mode is restricted to the service role' using errcode = '42501';
  end if;
  update public.app_settings set demo_mode = p_on where id;
  return p_on;
end;
$$;

revoke execute on function public.set_demo_mode(boolean) from public, anon, authenticated;
grant execute on function public.set_demo_mode(boolean) to service_role;
