-- Demo defections (Milestone 5): fictional events, sources and alerts so the
-- dashboard can be seen working before the agent has published anything. The
-- plan comes from scripts/lib/demo-events.ts. One transaction per call; rows
-- are keyed on dedupe_key, so a re-run adds nothing. Only fictional
-- legislators can be touched.

create or replace function public.seed_demo_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  row_no integer := 0;
  leg public.legislators;
  article_id bigint;
  event_id uuid;
  inserted integer := 0;
  published integer := 0;
  skipped integer := 0;
begin
  if coalesce(current_setting('role', true), 'none') not in ('service_role', 'none') then
    raise exception 'seed_demo_events is for the service role only';
  end if;

  for r in select * from jsonb_array_elements(p_events)
  loop
    row_no := row_no + 1;

    select * into leg from public.legislators
    where full_name = r ->> 'full_name'
      and chamber = r ->> 'chamber'
      and state = r ->> 'state'
      and is_fictional
      and status = 'sitting';
    if not found then
      raise exception 'row %: no sitting fictional legislator %', row_no, r ->> 'full_name';
    end if;

    insert into public.defection_events (
      legislator_id, raw_name, from_party_id, to_party_id, event_type, event_date,
      chamber, state, confidence, status, evidence_quote, reasoning_summary,
      model, prompt_version, dedupe_key
    )
    select leg.id, leg.full_name, fp.id, tp.id, 'CONFIRMED_DEFECTION', (r ->> 'event_date')::date,
           leg.chamber, leg.state,
           case when r ->> 'status' = 'published' then 0.92 else 0.7 end,
           case when r ->> 'status' = 'published' then 'detected' else 'in_review' end,
           r ->> 'evidence_quote', 'Fictional demo event; not produced by the detection agent.',
           'demo-seed', 'demo', r ->> 'dedupe_key'
    from public.parties fp, public.parties tp
    where fp.code = r ->> 'from_party' and tp.code = r ->> 'to_party'
    on conflict (dedupe_key) do nothing
    returning id into event_id;

    if event_id is null then
      skipped := skipped + 1;
      continue;
    end if;
    inserted := inserted + 1;

    insert into public.articles (url, outlet, title, published_at, prefilter_hit, classification, processed_at)
    values (
      r -> 'article' ->> 'url', r -> 'article' ->> 'outlet', r -> 'article' ->> 'title',
      (r -> 'article' ->> 'published_at')::timestamptz, true, 'CONFIRMED_DEFECTION', now()
    )
    on conflict (url) do update set title = excluded.title
    returning id into article_id;

    insert into public.event_sources (event_id, article_id, evidence_quote)
    values (event_id, article_id, r ->> 'evidence_quote');

    if r ->> 'status' = 'published' then
      perform public.publish_defection(event_id);
      published := published + 1;
    else
      insert into public.alerts (event_id, kind, level, title, body, is_fictional, dedupe_key)
      values (
        event_id, 'developing', 'unverified',
        format('Developing: reports say %s %s has defected to %s',
          case leg.chamber when 'senate' then 'Sen.' else 'Hon.' end, leg.full_name, r ->> 'to_party'),
        'Not yet confirmed; party counts are unchanged. 1 source.',
        true,
        format('event:%s:developing', event_id)
      );
    end if;
  end loop;

  return jsonb_build_object('inserted', inserted, 'published', published, 'skipped', skipped);
end;
$$;

revoke execute on function public.seed_demo_events(jsonb) from public, anon, authenticated;
grant execute on function public.seed_demo_events(jsonb) to service_role;
