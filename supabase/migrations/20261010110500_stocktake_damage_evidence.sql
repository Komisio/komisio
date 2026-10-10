-- Scans retain damage evidence without altering immutable observations.
create or replace function public.stocktake_report(p_tenant uuid,p_session uuid,p_filter text,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare closing public.stocktake_events; result jsonb; history jsonb; version integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_filter is null or p_filter not in ('all','unchecked','deviations') or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.stocktake_sessions where tenant_id=p_tenant and id=p_session) then raise exception 'STOCKTAKE_NOT_FOUND'; end if;
 select * into closing from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and kind='closed';
 select coalesce(max(seq),0) into version from public.stocktake_events where tenant_id=p_tenant and session_id=p_session;
 with item_ids as (
 select item_id from public.stocktake_expected_items where tenant_id=p_tenant and session_id=p_session
 union select item_id from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and item_id is not null
 ), rows as materialized (
 select i.item_id as id,coalesce(x.title,komisio_private.item_title(p_tenant,i.item_id)->>'title','') as title,
  x.item_id is not null as expected,coalesce(e.observation,'unchecked') as observation,coalesce(e.seq,0) as version,
  coalesce(f.reason,e.reason,'') as reason,coalesce(f.actor_name,e.actor_name,'') as actor,coalesce(f.created_at,e.created_at) as at,
  x.item_id is not null and case when closing.id is not null then i.item_id=any(closing.changed_items) else not komisio_private.stocktake_in_stock(p_tenant,i.item_id) end as changed
 from item_ids i left join public.stocktake_expected_items x on x.tenant_id=p_tenant and x.session_id=p_session and x.item_id=i.item_id
 left join lateral(select * from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session and e.item_id=i.item_id order by seq desc limit 1) e on true
   left join lateral(select f.reason,f.actor_name,f.created_at from public.stocktake_events f
    where f.tenant_id=p_tenant and f.session_id=p_session and f.item_id=i.item_id
    and e.kind='scan' and e.observation='damaged' and f.kind='finding' and f.observation='damaged' and f.seq<=e.seq
    order by f.seq desc limit 1) f on true
 ), filtered as (
 select * from rows where p_filter='all' or (p_filter='unchecked' and observation='unchecked' and not changed) or (p_filter='deviations' and (observation in ('missing','damaged') or not expected or changed))
 ) select jsonb_build_object('id',p_session,'closed',closing.id is not null,'version',version,
 'counts',(select jsonb_build_object('total',count(*),'unchecked',count(*) filter(where observation='unchecked' and not changed),'deviations',count(*) filter(where observation in ('missing','damaged') or not expected or changed)) from rows),
 'matching',(select count(*) from filtered),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.title,r.id) from (select * from filtered order by title,id limit 50 offset p_offset) r),'[]')) into result;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.seq desc),'[]') into history from (
  select e.seq,e.kind,e.observation,e.reason,e.item_id,e.actor_name as actor,e.created_at as at from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session order by seq desc limit 20) h;
 return result||jsonb_build_object('history',history);
end $$;

create or replace function public.stocktake_export(p_tenant uuid,p_session uuid,p_filter text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare closing public.stocktake_events; result jsonb; started timestamptz;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_filter is null or p_filter not in ('all','deviations') then raise exception 'INVALID_INPUT'; end if;
 select created_at into started from public.stocktake_sessions where tenant_id=p_tenant and id=p_session;
 if not found then raise exception 'STOCKTAKE_NOT_FOUND'; end if;
 select * into closing from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and kind='closed';
 if not found then raise exception 'STOCKTAKE_OPEN'; end if;
 with item_ids as (
  select item_id from public.stocktake_expected_items where tenant_id=p_tenant and session_id=p_session
  union select item_id from public.stocktake_events where tenant_id=p_tenant and session_id=p_session and item_id is not null
 ), rows as (
  select i.item_id as id,coalesce(x.title,komisio_private.item_title(p_tenant,i.item_id)->>'title','') as title,
   x.item_id is not null as expected,coalesce(e.observation,'unchecked') as observation,coalesce(e.seq,0) as version,
   coalesce(f.reason,e.reason,'') as reason,coalesce(f.actor_name,e.actor_name,'') as actor,coalesce(f.created_at,e.created_at) as at,
   x.item_id is not null and i.item_id=any(closing.changed_items) as changed
  from item_ids i left join public.stocktake_expected_items x on x.tenant_id=p_tenant and x.session_id=p_session and x.item_id=i.item_id
  left join lateral(select * from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session and e.item_id=i.item_id order by seq desc limit 1) e on true
   left join lateral(select f.reason,f.actor_name,f.created_at from public.stocktake_events f
    where f.tenant_id=p_tenant and f.session_id=p_session and f.item_id=i.item_id
    and e.kind='scan' and e.observation='damaged' and f.kind='finding' and f.observation='damaged' and f.seq<=e.seq
    order by f.seq desc limit 1) f on true
 ), bounded as (
  select * from rows where p_filter='all' or observation in ('missing','damaged') or not expected or changed
  order by title,id limit 5001
 ) select jsonb_build_object('id',p_session,'version',closing.seq,'startedAt',started,'closedAt',closing.created_at,
   'filter',p_filter,'rows',coalesce(jsonb_agg(to_jsonb(bounded) order by title,id),'[]')) into result from bounded;
 if jsonb_array_length(result->'rows')>5000 or octet_length(result::text)>3000000 then
  raise exception 'STOCKTAKE_EXPORT_TOO_LARGE';
 end if;
 return result;
end $$;
