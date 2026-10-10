-- Read-only completed count. One statement snapshot, never a page-sized export.
create function public.stocktake_export(p_tenant uuid,p_session uuid,p_filter text)
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
   coalesce(e.reason,'') as reason,coalesce(e.actor_name,'') as actor,e.created_at as at,
   x.item_id is not null and i.item_id=any(closing.changed_items) as changed
  from item_ids i left join public.stocktake_expected_items x on x.tenant_id=p_tenant and x.session_id=p_session and x.item_id=i.item_id
  left join lateral(select * from public.stocktake_events e where e.tenant_id=p_tenant and e.session_id=p_session and e.item_id=i.item_id order by seq desc limit 1) e on true
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
revoke all on function public.stocktake_export(uuid,uuid,text) from public,anon;
grant execute on function public.stocktake_export(uuid,uuid,text) to authenticated;
