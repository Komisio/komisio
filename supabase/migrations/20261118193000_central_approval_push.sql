-- Keep protocol 2 compatible with deployed workers; protocol 3 adds approval copy.
CREATE OR REPLACE FUNCTION public.seller_push_candidates(p_protocol integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 if p_protocol is null or p_protocol not in (2,3) then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]') into result from (
  select q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",
   q.request_id as "requestId",q.owner_id as "ownerId",
   case when q.kind='external_item_offered' then q.reference_id end as "offerId",
   q.kind,q.created_at as "createdAt",d.locale,left(t.name,120) as "storeName",
   left(coalesce(nullif(komisio_private.item_title(q.tenant_id,q.item_id)->>'title',''),'Komisio'),120) as "itemLabel"
  from komisio_private.seller_push_deliveries q join komisio_private.seller_push_devices d on d.id=q.device_id
  join public.tenants t on t.id=q.tenant_id where q.state='queued' order by q.created_at,q.id limit 50
 ) x;
 if p_protocol=3 then
  select coalesce(jsonb_agg(value || jsonb_build_object('approved',exists(select 1 from public.external_item_offers o
    where o.id=(value->>'offerId')::uuid and o.approval_source='fixed_request'))),'[]') into result from jsonb_array_elements(result);
 end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION komisio_private.external_push_eligible(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from komisio_private.seller_push_deliveries q
  join komisio_private.seller_push_devices d on d.id=q.device_id and d.generation=q.device_generation and d.user_id=q.owner_id
  join public.external_item_requests r on r.id=q.request_id and r.owner_id=q.owner_id and r.tenant_id=q.tenant_id
  join public.platform_settings p on p.only_row and p.central_app_tenant_id=r.tenant_id
  where q.id=p_id and r.sender_country='SE' and d.enabled and komisio_private.external_push_session_valid(d.user_id,d.session_id)
  and ((q.kind='external_item_offered' and exists(select 1 from public.external_item_offers o
    where o.id=q.reference_id and o.request_id=r.id and ((o.approval_source='seller_response' and o.expires_at>clock_timestamp()
      and not exists(select 1 from public.external_item_offer_responses a where a.offer_id=o.id))
     or (o.approval_source='fixed_request' and exists(select 1 from public.external_item_offer_responses a
       where a.offer_id=o.id and a.accepted and a.approval_actor_id=o.created_by)))
    and not exists(select 1 from public.external_item_request_declines x where x.request_id=r.id)))
   or (q.kind='external_item_declined' and exists(select 1 from public.external_item_request_declines x
    where x.id=q.reference_id and x.request_id=r.id and x.created_by<>r.owner_id))))
$function$;
