-- Database migrations precede application promotion. Old workers must keep
-- processing ordinary store notifications while new workers opt into requests.
create function public.seller_push_candidates(p_protocol integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 if p_protocol is distinct from 2 then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]') into result from (
  select q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",
   q.request_id as "requestId",q.owner_id as "ownerId",
   case when q.kind='external_item_offered' then q.reference_id end as "offerId",
   q.kind,q.created_at as "createdAt",d.locale,left(t.name,120) as "storeName",
   left(coalesce(nullif(komisio_private.item_title(q.tenant_id,q.item_id)->>'title',''),'Komisio'),120) as "itemLabel"
  from komisio_private.seller_push_deliveries q join komisio_private.seller_push_devices d on d.id=q.device_id
  join public.tenants t on t.id=q.tenant_id where q.state='queued' order by q.created_at,q.id limit 50
 ) x;
 return result;
end $$;
revoke all on function public.seller_push_candidates(integer) from public,anon,authenticated;
grant execute on function public.seller_push_candidates(integer) to authenticated;

create or replace function public.seller_push_candidates() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]') into result from (
  select q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",q.kind,q.created_at as "createdAt",
   d.locale,left(t.name,120) as "storeName",left(coalesce(nullif(komisio_private.item_title(q.tenant_id,q.item_id)->>'title',''),'Komisio'),120) as "itemLabel"
  from komisio_private.seller_push_deliveries q join komisio_private.seller_push_devices d on d.id=q.device_id
  join public.tenants t on t.id=q.tenant_id where q.state='queued' and q.request_id is null order by q.created_at,q.id limit 50
 ) x;
 return result;
end $$;

-- Ordinary claims keep the exact strict v1 transport shape too. Both readers
-- claim the same locked row, so mixed worker versions cannot send it twice.
do $$ declare original text; definition text; begin
 original:=pg_get_functiondef('public.claim_seller_push(uuid,text,text,text)'::regprocedure);
 definition:=replace(original,
  $needle$return jsonb_build_object('id',p_id,$needle$,
  $replacement$if q.request_id is null then
   return jsonb_build_object('id',p_id,'token',d.token,'platform',d.platform,'kind',q.kind,'tenantId',q.tenant_id,'sellerId',q.seller_id,'itemId',q.item_id,'title',trim(p_subject),'body',trim(p_body));
  end if;
  return jsonb_build_object('id',p_id,$replacement$);
 if definition=original then raise exception 'MISSING_PUSH_CLAIM_RETURN'; end if;
 execute definition;
end $$;
