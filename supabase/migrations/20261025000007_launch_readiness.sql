-- Read-only deployment audit. Only the service role may inspect these counts
-- and database privileges; this report is never served by the public app.
create or replace function public.launch_readiness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'demo_mode', (select demo_mode from public.app_settings where id),
    'real_members', (select count(*) from public.legislators where not is_fictional),
    'sitting_senators', (select count(*) from public.legislators where not is_fictional and status = 'sitting' and chamber = 'senate'),
    'sitting_representatives', (select count(*) from public.legislators where not is_fictional and status = 'sitting' and chamber = 'house'),
    'missing_provenance', (select count(*) from public.legislators where not is_fictional
      and (nullif(trim(source_url), '') is null or verified_at is null)),
    'rls_disabled', (select coalesce(jsonb_agg(v.name), '[]'::jsonb)
      from (values ('ng_states'), ('parties'), ('app_settings'), ('legislators'),
        ('party_affiliations'), ('agent_runs'), ('articles'), ('defection_events'),
        ('event_sources'), ('alerts'), ('review_feedback')) v(name)
      left join pg_catalog.pg_class c on c.oid = to_regclass('public.' || v.name)
      where c.oid is null or not c.relrowsecurity),
    'article_content_exposed', has_column_privilege('anon', 'public.articles', 'content', 'SELECT')
      or has_column_privilege('authenticated', 'public.articles', 'content', 'SELECT'),
    'missing_functions', (select coalesce(jsonb_agg(v.signature), '[]'::jsonb)
      from (values ('public.publish_defection(uuid)'), ('public.reverse_defection(uuid,text)'),
        ('public.review_approve(uuid,jsonb,text)'), ('public.review_edit(uuid,jsonb,text)'),
        ('public.review_reject(uuid,text,text)'), ('public.review_merge(uuid,uuid,text)'),
        ('public.seed_historical_events(jsonb)')) v(signature)
      where to_regprocedure(v.signature) is null),
    'admin_visibility_policy', exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'legislators' and policyname = 'admins read all legislators')
  );
$$;

revoke execute on function public.launch_readiness() from public, anon, authenticated;
grant execute on function public.launch_readiness() to service_role;
