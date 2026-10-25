-- Admin review (SPEC §10 M7, AGENT.md §8): approve (with optional edits),
-- edit, reject and merge. Each runs in one transaction, is callable only by
-- an admin or the service role (assert_can_publish), and records what the
-- reviewer saw and changed in review_feedback. Admins still have no direct
-- table writes; reversal stays with reverse_defection.

create or replace function public.review_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(current_setting('role', true), 'none') = 'authenticated'
      then nullif(auth.jwt() ->> 'sub', '')::uuid
  end;
$$;

-- The fields a reviewer judges, with parties as codes so feedback reads
-- without joins.
create or replace function public.review_snapshot(e public.defection_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', e.status,
    'legislator_id', e.legislator_id,
    'raw_name', e.raw_name,
    'from_party', (select code from public.parties where id = e.from_party_id),
    'to_party', (select code from public.parties where id = e.to_party_id),
    'event_date', e.event_date,
    'confidence', e.confidence,
    'review_flags', e.review_flags,
    'review_note', e.review_note
  );
$$;

-- Locks an event that is still open for review.
create or replace function public.review_lock(p_event_id uuid)
returns public.defection_events
language plpgsql
set search_path = ''
as $$
declare
  e public.defection_events;
begin
  perform public.assert_can_publish();
  select * into e from public.defection_events where id = p_event_id for update;
  if not found then
    raise exception 'defection event % not found', p_event_id using errcode = 'P0002';
  end if;
  if e.status not in ('detected', 'in_review') then
    raise exception 'this event was already reviewed (status is %)', e.status;
  end if;
  return e;
end;
$$;

-- Applies reviewer corrections. Keys: legislator_id, from_party, to_party
-- (party codes), event_date. Returns whether anything changed.
create or replace function public.review_apply_edits(p_event_id uuid, p_edits jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  e public.defection_events;
  l public.legislators;
  party_id smallint;
  unknown text;
begin
  select string_agg(k, ', ') into unknown
  from jsonb_object_keys(coalesce(p_edits, '{}')) k
  where k not in ('legislator_id', 'from_party', 'to_party', 'event_date');
  if unknown is not null then
    raise exception 'unknown edit fields: %', unknown;
  end if;

  select * into e from public.defection_events where id = p_event_id;

  if p_edits ? 'legislator_id' then
    select * into l from public.legislators where id = (p_edits ->> 'legislator_id')::uuid;
    if not found then
      raise exception 'legislator % not found', p_edits ->> 'legislator_id';
    end if;
    e.legislator_id := l.id;
    e.chamber := l.chamber;
    e.state := l.state;
  end if;

  if p_edits ? 'from_party' then
    if p_edits ->> 'from_party' is null then
      e.from_party_id := null;
    else
      select id into party_id from public.parties where code = p_edits ->> 'from_party';
      if not found then
        raise exception 'unknown party %', p_edits ->> 'from_party';
      end if;
      e.from_party_id := party_id;
    end if;
  end if;

  if p_edits ? 'to_party' then
    select id into party_id from public.parties where code = p_edits ->> 'to_party';
    if not found then
      raise exception 'unknown destination party %', coalesce(p_edits ->> 'to_party', '(none)');
    end if;
    e.to_party_id := party_id;
  end if;

  if p_edits ? 'event_date' then
    e.event_date := (p_edits ->> 'event_date')::date;
  end if;

  update public.defection_events d
  set legislator_id = e.legislator_id, chamber = e.chamber, state = e.state,
      from_party_id = e.from_party_id, to_party_id = e.to_party_id, event_date = e.event_date
  where d.id = p_event_id
    and (d.legislator_id, d.from_party_id, d.to_party_id, d.event_date)
        is distinct from (e.legislator_id, e.from_party_id, e.to_party_id, e.event_date);
  return found;
end;
$$;

create or replace function public.review_edit(p_event_id uuid, p_edits jsonb, p_note text default null)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  before jsonb;
begin
  e := public.review_lock(p_event_id);
  before := public.review_snapshot(e);
  if not public.review_apply_edits(p_event_id, p_edits) then
    raise exception 'nothing to change';
  end if;
  update public.defection_events
  set review_note = coalesce(nullif(trim(p_note), ''), review_note)
  where id = p_event_id
  returning * into e;
  insert into public.review_feedback (event_id, action, before, after, reviewer)
  values (p_event_id, 'edit', before, public.review_snapshot(e), public.review_actor());
  return e;
end;
$$;

-- Edits (if any) and publishing succeed or fail together: a refusal from
-- publish_defection rolls the edits and the feedback back too.
create or replace function public.review_approve(p_event_id uuid, p_edits jsonb default '{}', p_note text default null)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  before jsonb;
  edited jsonb;
begin
  e := public.review_lock(p_event_id);
  before := public.review_snapshot(e);
  if public.review_apply_edits(p_event_id, p_edits) then
    select public.review_snapshot(d) into edited from public.defection_events d where d.id = p_event_id;
    insert into public.review_feedback (event_id, action, before, after, reviewer)
    values (p_event_id, 'edit', before, edited, public.review_actor());
  end if;
  if nullif(trim(p_note), '') is not null then
    update public.defection_events set review_note = trim(p_note) where id = p_event_id;
  end if;

  e := public.publish_defection(p_event_id);

  insert into public.review_feedback (event_id, action, before, after, reviewer)
  values (p_event_id, 'approve', before, public.review_snapshot(e), public.review_actor());
  return e;
end;
$$;

create or replace function public.review_reject(p_event_id uuid, p_reason text, p_note text default null)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  before jsonb;
begin
  e := public.review_lock(p_event_id);
  if p_reason is null or p_reason not in ('rumour', 'denied', 'wrong_person', 'not_legislator', 'duplicate', 'other') then
    raise exception 'a rejection reason is required (rumour, denied, wrong_person, not_legislator, duplicate or other)';
  end if;
  if p_reason = 'other' and coalesce(trim(p_note), '') = '' then
    raise exception 'explain the rejection in a note when the reason is "other"';
  end if;
  before := public.review_snapshot(e);
  update public.defection_events
  set status = 'rejected',
      review_note = coalesce(nullif(trim(p_note), ''), review_note),
      reviewed_by = coalesce(public.review_actor(), reviewed_by),
      reviewed_at = now()
  where id = p_event_id
  returning * into e;
  insert into public.review_feedback (event_id, action, reason_code, before, after, reviewer)
  values (p_event_id, 'reject', p_reason, before, public.review_snapshot(e), public.review_actor());
  return e;
end;
$$;

-- Folds a duplicate into another event: its sources move to the target, and
-- it is closed as rejected (reason: duplicate) pointing at the target.
create or replace function public.review_merge(p_event_id uuid, p_target_id uuid, p_note text default null)
returns public.defection_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.defection_events;
  target public.defection_events;
  before jsonb;
begin
  e := public.review_lock(p_event_id);
  if p_target_id = p_event_id then
    raise exception 'an event cannot be merged into itself';
  end if;
  select * into target from public.defection_events where id = p_target_id for update;
  if not found then
    raise exception 'target event % not found', p_target_id using errcode = 'P0002';
  end if;
  if target.status not in ('detected', 'in_review', 'published') then
    raise exception 'cannot merge into an event with status %', target.status;
  end if;

  before := public.review_snapshot(e);
  insert into public.event_sources (event_id, article_id, evidence_quote)
  select p_target_id, article_id, evidence_quote from public.event_sources where event_id = p_event_id
  on conflict (event_id, article_id) do nothing;

  update public.defection_events
  set status = 'rejected',
      review_note = format('Merged into %s.%s', p_target_id, coalesce(' ' || nullif(trim(p_note), ''), '')),
      reviewed_by = coalesce(public.review_actor(), reviewed_by),
      reviewed_at = now()
  where id = p_event_id
  returning * into e;
  insert into public.review_feedback (event_id, action, reason_code, before, after, reviewer)
  values (
    p_event_id, 'merge', 'duplicate', before,
    public.review_snapshot(e) || jsonb_build_object('merged_into', p_target_id),
    public.review_actor()
  );
  return target;
end;
$$;

revoke execute on function
  public.review_actor(),
  public.review_snapshot(public.defection_events),
  public.review_lock(uuid),
  public.review_apply_edits(uuid, jsonb)
  from public, anon, authenticated;

revoke execute on function
  public.review_edit(uuid, jsonb, text),
  public.review_approve(uuid, jsonb, text),
  public.review_reject(uuid, text, text),
  public.review_merge(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.review_edit(uuid, jsonb, text),
  public.review_approve(uuid, jsonb, text),
  public.review_reject(uuid, text, text),
  public.review_merge(uuid, uuid, text)
  to authenticated, service_role;
