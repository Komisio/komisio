create function public.read_external_item_offer(p_offer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare offer public.external_item_offers; answer public.external_item_offer_responses;
 agreement public.seller_agreement_versions; latest uuid; state text; at_time timestamptz:=clock_timestamp();
begin
 select * into offer from public.external_item_offers o where o.id=p_offer and (
  (o.owner_id=auth.uid() and public.external_phone_verified())
  or public.tenant_role(o.tenant_id) in ('owner','admin','staff','readonly'));
 if offer.id is null then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 select * into answer from public.external_item_offer_responses where offer_id=p_offer;
 select * into agreement from public.seller_agreement_versions where id=offer.agreement_version_id and tenant_id=offer.tenant_id;
 select id into latest from public.external_item_offers where request_id=offer.request_id order by created_at desc,id limit 1;
 state:=case
  when answer.accepted then 'accepted'
  when answer.id is not null or exists(select 1 from public.external_item_request_declines where request_id=offer.request_id) then 'declined'
  when latest<>offer.id then 'superseded'
  when offer.expires_at<=at_time then 'expired'
  else 'offered' end;
 return jsonb_build_object('id',offer.id,'requestId',offer.request_id,'tenantId',offer.tenant_id,
  'sellerAmountOre',offer.seller_amount_ore::text,'expectedSalePriceOre',offer.expected_sale_price_ore::text,'currency',offer.currency,
  'agreementVersionId',offer.agreement_version_id,'createdAt',offer.created_at,'expiresAt',offer.expires_at,
  'status',state,'canAccept',state='offered','canDecline',state in ('offered','expired'),'serverNow',at_time,
  'agreement',jsonb_build_object('id',agreement.id,'version',agreement.version,'title',agreement.title,'body',agreement.body,'language',agreement.language),
  'response',case when answer.id is null then null else jsonb_build_object('id',answer.id,'accepted',answer.accepted,'createdAt',answer.created_at) end);
end $$;

create function public.my_external_item_offers(p_requests uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); rows jsonb;
begin
 if p_requests is null or cardinality(p_requests)>25 or array_position(p_requests,null) is not null
  or cardinality(p_requests)<>(select count(distinct id) from unnest(p_requests) id) then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from unnest(p_requests) q(id) where not exists(select 1 from public.external_item_requests r where r.id=q.id and r.owner_id=uid))
  then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.read_external_item_offer(x.id)-'agreement' order by x.request_id),'[]') into rows from (
  select distinct on(request_id) id,request_id from public.external_item_offers
  where owner_id=uid and request_id=any(p_requests) order by request_id,created_at desc,id
 ) x;
 return jsonb_build_object('offers',rows,'serverNow',clock_timestamp());
end $$;
revoke all on function public.read_external_item_offer(uuid),public.my_external_item_offers(uuid[]) from public,anon,authenticated;
grant execute on function public.read_external_item_offer(uuid),public.my_external_item_offers(uuid[]) to authenticated;
