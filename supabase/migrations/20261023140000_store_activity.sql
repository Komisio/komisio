-- Read-only activity directory. No payload details or cross-store profile reads.
create index access_events_tenant_order on public.access_events(tenant_id,occurred_at desc,id desc);
create index access_events_tenant_actor_order on public.access_events(tenant_id,actor_id,occurred_at desc,id desc);
create index access_events_tenant_action_order on public.access_events(tenant_id,action,occurred_at desc,id desc);

create function public.store_activity(
 p_tenant uuid, p_from date default null, p_to date default null,
 p_actor uuid default null, p_action text default null,
 p_offset integer default 0, p_limit integer default 25
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; actors jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_offset is null or p_offset not between 0 and 1000000 or p_limit is null or p_limit not between 1 and 100
  or (p_from is not null and (not isfinite(p_from) or p_from not between date '0001-01-01' and date '9999-12-31'))
  or (p_to is not null and (not isfinite(p_to) or p_to not between date '0001-01-01' and date '9999-12-31'))
  or p_from>p_to or length(p_action)>120 then raise exception 'INVALID_INPUT'; end if;

 with filtered as not materialized (
  select e.id,e.actor_id,e.action,e.target_id,e.occurred_at from public.access_events e
  where e.tenant_id=p_tenant
   and (p_from is null or e.occurred_at >= (p_from::timestamp at time zone 'Europe/Stockholm'))
   and (p_to is null or e.occurred_at < ((p_to+1)::timestamp at time zone 'Europe/Stockholm'))
   and (p_actor is null or e.actor_id=p_actor) and (p_action is null or e.action=p_action)
 ), page as (
  select * from filtered order by occurred_at desc,id desc offset p_offset limit p_limit
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',e.id::text,'actor_id',e.actor_id,'actor_name',nullif(p.display_name,''),
   'actor_state',case when e.actor_id is null then 'system' when m.user_id is null then 'former' else 'member' end,
   'action',e.action,'target_id',e.target_id,'occurred_at',e.occurred_at
  ) order by e.occurred_at desc,e.id desc)
  from page e left join public.tenant_members m on m.tenant_id=p_tenant and m.user_id=e.actor_id
  left join public.user_profiles p on p.user_id=m.user_id
 ),'[]'::jsonb)) into result;

 -- Suggestions are bounded; the UI also accepts an exact actor ID, so old
 -- actors beyond these suggestions remain filterable without an unbounded list.
 with recent as (
  select e.actor_id,max(e.occurred_at) last_seen from public.access_events e
  where e.tenant_id=p_tenant and e.actor_id is not null group by e.actor_id
  order by max(e.occurred_at) desc,e.actor_id limit 100
 ) select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.actor_id,'name',nullif(p.display_name,''),'former',m.user_id is null
  ) order by r.last_seen desc,r.actor_id),'[]'::jsonb) into actors
 from recent r left join public.tenant_members m on m.tenant_id=p_tenant and m.user_id=r.actor_id
 left join public.user_profiles p on p.user_id=m.user_id;
 return result || jsonb_build_object('actors',actors);
end $$;
revoke all on function public.store_activity(uuid,date,date,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.store_activity(uuid,date,date,uuid,text,integer,integer) to authenticated;
