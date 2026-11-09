-- Public discovery for owner-approved external requests. This is not a seller
-- lookup, membership grant or promise that a later submission will be accepted.
create function public.public_external_app_stores(
 p_query text default '', p_limit integer default 25,
 p_offset integer default 0, p_tenant uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page jsonb; needle text;
begin
 if p_query is null or length(p_query)>100 or p_limit is null or p_limit not between 1 and 50
  or p_offset is null or p_offset not between 0 and 10000 then
  raise exception 'INVALID_INPUT';
 end if;
 needle:=lower(btrim(p_query));
 select coalesce(jsonb_agg(s.value order by s.sort_name,s.id),'[]'::jsonb) into page
 from (
  select t.id,lower(t.name) as sort_name,jsonb_build_object(
   'id',t.id,'name',t.name,'slug',t.slug,
   'city',nullif(p.profile#>>'{address,city}',''),
   'country',nullif(p.profile#>>'{address,country}',''),
   'currency',coalesce(v.policy->>'currency','SEK')
  ) as value
  from public.tenants t
  join lateral (
   select policy from public.store_policy_versions where tenant_id=t.id order by version desc limit 1
  ) v on v.policy->'externalAppSubmissionsEnabled'='true'::jsonb
  left join lateral (
   select profile from public.store_profile_versions where tenant_id=t.id order by version desc limit 1
  ) p on true
  where (p_tenant is null or t.id=p_tenant)
   and (needle='' or position(needle in lower(t.name||' '||coalesce(p.profile#>>'{address,city}','')))>0)
  order by lower(t.name),t.id
  limit p_limit+1 offset p_offset
 ) s;
 return jsonb_build_object(
  'stores',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
   from jsonb_array_elements(page) with ordinality e(value,ord) where ord<=p_limit),
  'hasMore',jsonb_array_length(page)>p_limit
 );
end $$;
revoke all on function public.public_external_app_stores(text,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.public_external_app_stores(text,integer,integer,uuid) to anon,authenticated;
