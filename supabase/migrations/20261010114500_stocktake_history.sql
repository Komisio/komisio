-- Open-session discovery is independent of the requested history page.
create function public.stocktake_session_history(p_tenant uuid,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>2000000 then raise exception 'INVALID_INPUT'; end if;
 with sessions as materialized (
  select s.id,s.created_at as at,s.actor_name as actor,
   exists(select 1 from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=s.id and e.kind='closed') as closed
  from public.stocktake_sessions s where s.tenant_id=p_tenant
 ), page as (select * from sessions order by closed,at desc,id limit 20 offset p_offset)
 select jsonb_build_object('total',(select count(*) from sessions),
  'activeId',(select id from sessions where not closed order by at desc,id limit 1),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.closed,p.at desc,p.id) from page p),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.stocktake_session_history(uuid,integer) from public,anon;
grant execute on function public.stocktake_session_history(uuid,integer) to authenticated;
