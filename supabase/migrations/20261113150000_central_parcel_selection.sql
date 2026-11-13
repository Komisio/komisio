-- A parcel combines logistics only: H-handovers and receipt clocks stay separate.
create function komisio_private.central_parcel_contents(p_parcel uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('offerId',i.offer_id,'description',r.description,
  'handoverId',h.id,'reference','H-'||h.reference,'status',h.status) order by h.reference),'[]'::jsonb)
 from public.central_parcel_items i join public.external_item_offers o on o.id=i.offer_id
 join public.external_item_requests r on r.id=o.request_id join public.seller_handovers h on h.id=i.handover_id
 where i.parcel_id=p_parcel;
$$;
revoke all on function komisio_private.central_parcel_contents(uuid) from public,anon,authenticated;

create or replace function public.read_central_parcel(p_offer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); o public.external_item_offers; p public.central_parcels; booking_row public.central_parcel_booking_results;
begin
 select * into o from public.external_item_offers where id=p_offer and owner_id=uid;
 if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 if exists(select 1 from public.sellers where tenant_id=o.tenant_id and external_owner_id=uid and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 select cp.* into p from public.central_parcels cp join public.central_parcel_items i on i.parcel_id=cp.id where i.offer_id=p_offer and cp.owner_id=uid;
 if found then select * into booking_row from public.central_parcel_booking_results where parcel_id=p.id; end if;
 return jsonb_build_object('offerId',p_offer,'configured',exists(select 1 from komisio_private.central_shipping_runtime c join public.platform_settings ps on ps.central_app_tenant_id=c.tenant_id where c.tenant_id=o.tenant_id and ps.only_row),'eligibleItems',coalesce((select jsonb_agg(x.item order by x.created_at,x.offer_id) from (
   select l.offer_id,r.created_at,jsonb_build_object('offerId',l.offer_id,'description',r.description,'handoverId',h.id,'reference','H-'||h.reference,'status',h.status) as item
   from public.external_item_handover_links l join public.external_item_offers eo on eo.id=l.offer_id
   join public.external_item_requests r on r.id=eo.request_id join public.seller_handovers h on h.id=l.handover_id
   where l.owner_id=uid and l.tenant_id=o.tenant_id and h.status='open'
    and l.tenant_id=(select central_app_tenant_id from public.platform_settings where only_row)
    and not exists(select 1 from public.central_parcel_items i where i.offer_id=l.offer_id or i.handover_id=l.handover_id)
    and (select count(*) from public.external_item_handover_links same where same.handover_id=h.id)=1
   order by r.created_at,l.offer_id limit 10) x),'[]'::jsonb),'parcel',case when p.id is null then null else
  jsonb_build_object('id',p.id,'reference','P-'||p.reference,'environment',p.environment,'sender',p.sender,'recipient',p.recipient,
   'weightG',p.weight_g,'lengthMm',p.length_mm,'widthMm',p.width_mm,'heightMm',p.height_mm,
   'status',case when booking_row.parcel_id is null then 'pending' when booking_row.result is null then 'needs_review' else 'booked' end,
   'items',komisio_private.central_parcel_contents(p.id),'booking',booking_row.result,'createdAt',p.created_at) end);
end $$;

-- Keep the deployed singleton RPC and its replay hashes unchanged for older apps.
create function public.claim_central_parcel_group(p_id uuid,p_offer uuid,p_offers uuid[],p_address jsonb,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); l public.external_item_handover_links; s public.sellers;
 cfg komisio_private.central_shipping_runtime; prior public.central_parcels; h public.seller_handovers;
 ids uuid[]; digest text; sender jsonb; phone text; ref bigint; anchor_reference bigint; candidate uuid;
begin
 perform komisio_private.require_shipping_server();
 if p_id is null or p_offer is null or not komisio_private.valid_parcel_address(p_address,false)
  or p_offers is null or cardinality(p_offers) not between 1 and 10 or array_position(p_offers,null) is not null
  or not(p_offer=any(p_offers)) then raise exception 'INVALID_INPUT'; end if;
 select array_agg(distinct id order by id) into ids from unnest(p_offers) id;
 if cardinality(ids)<>cardinality(p_offers) then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into l from public.external_item_handover_links where offer_id=p_offer and owner_id=uid;
 if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 perform 1 from public.tenants where id=l.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into s from public.sellers where tenant_id=l.tenant_id and id=l.seller_id;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('anchor',p_offer,'offers',ids,'address',p_address,'environment',p_environment)::text,'UTF8')),'hex');
 select * into prior from public.central_parcels where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.tenant_id<>l.tenant_id or prior.payload_hash<>digest then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('dispatch',false,'parcel',public.read_central_parcel(p_offer)->'parcel');
 end if;
 -- Validate every selected item before inserting anything or dispatching once.
 foreach candidate in array ids loop
  select sh.* into h from public.external_item_handover_links x join public.seller_handovers sh on sh.id=x.handover_id
   where x.offer_id=candidate and x.owner_id=uid and x.tenant_id=l.tenant_id and x.seller_id=l.seller_id for update of sh;
  if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
  if exists(select 1 from public.central_parcel_items where offer_id=candidate or handover_id=h.id) then raise exception 'PARCEL_EXISTS'; end if;
  if h.status<>'open' then raise exception 'HANDOVER_CLOSED'; end if;
  if (select count(*) from public.external_item_handover_links where handover_id=h.id)<>1 then raise exception 'PARCEL_GROUP_UNSUPPORTED'; end if;
  if candidate=p_offer then anchor_reference:=h.reference; end if;
 end loop;
 select * into cfg from komisio_private.central_shipping_runtime where singleton;
 if cfg.tenant_id is distinct from l.tenant_id or cfg.environment is distinct from p_environment
  or l.tenant_id is distinct from (select central_app_tenant_id from public.platform_settings where only_row)
 then raise exception 'SHIPPING_UNAVAILABLE'; end if;
 select '+'||ltrim(u.phone,'+') into phone from auth.users u where u.id=uid;
 sender:=p_address||jsonb_build_object('name',s.name,'email',s.email,'phone',phone,'country','SE');
 if not komisio_private.valid_parcel_address(sender,true) then raise exception 'SHIPPING_CONTACT_UNSUPPORTED'; end if;
 insert into public.central_parcels(id,tenant_id,owner_id,sender,recipient,environment,payload_hash)
 values(p_id,l.tenant_id,uid,sender,cfg.recipient,cfg.environment,digest) returning reference into ref;
 insert into public.central_parcel_items(parcel_id,tenant_id,owner_id,offer_id,handover_id)
 select p_id,l.tenant_id,uid,x.offer_id,x.handover_id from public.external_item_handover_links x where x.offer_id=any(ids);
 perform komisio_private.record_access(l.tenant_id,'central_parcel.dispatched',p_id,jsonb_build_object('offer_id',p_offer,'offer_ids',ids));
 return jsonb_build_object('dispatch',true,'parcel',public.read_central_parcel(p_offer)->'parcel',
  'handoverReference','H-'||anchor_reference,'messageId','K'||ref);
end $$;
revoke all on function public.claim_central_parcel_group(uuid,uuid,uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_central_parcel_group(uuid,uuid,uuid[],jsonb,text) to authenticated;

-- Resolve the whole manifest from any H-reference printed on a parcel label.
-- This read grants no receipt authority; ordinary staff receipt remains required.
create function public.handover_parcels(p_tenant uuid,p_handovers uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_handovers is null or cardinality(p_handovers)>100 then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('reference','P-'||p.reference,'items',komisio_private.central_parcel_contents(p.id)) order by p.reference)
  from public.central_parcels p where p.tenant_id=p_tenant and exists(select 1 from public.central_parcel_items i
   where i.parcel_id=p.id and i.tenant_id=p_tenant and i.handover_id=any(p_handovers))),'[]'::jsonb);
end $$;
revoke all on function public.handover_parcels(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.handover_parcels(uuid,uuid[]) to authenticated;
