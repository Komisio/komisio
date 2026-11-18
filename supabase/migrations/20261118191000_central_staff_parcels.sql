-- Staff booking uses the same parcel model and immutable provider outcome.
alter table public.central_parcels add column booked_by uuid references auth.users(id);

create function komisio_private.central_parcel_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'reference','P-'||p.reference,'environment',p.environment,'sender',p.sender,'recipient',p.recipient,
  'weightG',p.weight_g,'lengthMm',p.length_mm,'widthMm',p.width_mm,'heightMm',p.height_mm,
  'serviceCode',p.service_code,'estimatedWeightG',p.estimated_weight_g,
  'status',case when b.parcel_id is null then 'pending' when b.result is null then 'needs_review' else 'booked' end,
  'items',komisio_private.central_parcel_contents(p.id),'booking',b.result,'createdAt',p.created_at)
 from public.central_parcels p left join public.central_parcel_booking_results b on b.parcel_id=p.id where p.id=p_id;
$$;
revoke all on function komisio_private.central_parcel_json(uuid) from public,anon,authenticated;

create function public.claim_staff_central_parcel(p_id uuid,p_tenant uuid,p_owner uuid,p_offers uuid[],p_revision integer,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); ids uuid[]; s public.sellers; prior public.central_parcels; cfg komisio_private.central_shipping_runtime;
 h public.seller_handovers; profile jsonb; sender jsonb; digest text; candidate uuid; ref bigint; anchor bigint;
begin
 perform komisio_private.require_shipping_server();
 if p_id is null or p_tenant is null or p_owner is null or p_revision is null or p_revision<1
  or p_offers is null or cardinality(p_offers) not between 1 and 10 or array_ndims(p_offers)<>1
  or array_position(p_offers,null) is not null then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select array_agg(distinct id order by id) into ids from unnest(p_offers) id;
 if cardinality(ids)<>cardinality(p_offers) then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(p_owner);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('tenant',p_tenant,'owner',p_owner,'offers',ids,'revision',p_revision,'environment',p_environment)::text,'UTF8')),'hex');
 select * into prior from public.central_parcels where id=p_id;
 if found then
  if prior.owner_id<>p_owner or prior.tenant_id<>p_tenant or prior.booked_by is distinct from uid or prior.payload_hash<>digest then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('dispatch',false,'parcel',komisio_private.central_parcel_json(p_id));
 end if;
 select * into s from public.sellers where tenant_id=p_tenant and external_owner_id=p_owner for update;
 if s.id is null or s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 if s.profile_revision<>p_revision then raise exception 'PROFILE_CHANGED'; end if;
 select v.profile into profile from public.seller_profile_versions v where v.tenant_id=p_tenant and v.seller_id=s.id and v.revision=p_revision;
 if not komisio_private.valid_shipping_contact(profile->'shippingContact') then raise exception 'SHIPPING_CONTACT_UNSUPPORTED'; end if;
 foreach candidate in array ids loop
  select sh.* into h from public.external_item_handover_links x join public.seller_handovers sh on sh.id=x.handover_id
   where x.offer_id=candidate and x.owner_id=p_owner and x.tenant_id=p_tenant and x.seller_id=s.id for update of sh;
  if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
  if exists(select 1 from public.central_parcel_items where offer_id=candidate or handover_id=h.id) then raise exception 'PARCEL_EXISTS'; end if;
  if h.status<>'open' then raise exception 'HANDOVER_CLOSED'; end if;
  if (select count(*) from public.external_item_handover_links where handover_id=h.id)<>1 then raise exception 'PARCEL_GROUP_UNSUPPORTED'; end if;
  anchor:=coalesce(anchor,h.reference);
 end loop;
 select * into cfg from komisio_private.central_shipping_runtime where singleton;
 if cfg.tenant_id is distinct from p_tenant or cfg.environment is distinct from p_environment
  or p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'SHIPPING_UNAVAILABLE'; end if;
 sender:=jsonb_build_object('name',trim(profile#>>'{shippingContact,firstName}')||' '||trim(profile#>>'{shippingContact,lastName}'),
  'phone',profile#>>'{shippingContact,phone}','email',s.email,'street',trim(concat_ws(' ',nullif(profile->>'addressLine1',''),nullif(profile->>'addressLine2',''))),
  'postalCode',profile->>'postalCode','city',profile->>'city','country',profile->>'country');
 if not komisio_private.valid_parcel_address(sender,true) then raise exception 'SHIPPING_CONTACT_UNSUPPORTED'; end if;
 insert into public.central_parcels(id,tenant_id,owner_id,sender,recipient,environment,payload_hash,service_code,estimated_weight_g,booked_by)
 values(p_id,p_tenant,p_owner,sender,cfg.recipient,cfg.environment,digest,cfg.service_code,komisio_private.central_parcel_estimated_weight(ids,cfg.service_code),uid) returning reference into ref;
 insert into public.central_parcel_items(parcel_id,tenant_id,owner_id,offer_id,handover_id)
 select p_id,p_tenant,p_owner,x.offer_id,x.handover_id from public.external_item_handover_links x where x.offer_id=any(ids);
 perform komisio_private.record_access(p_tenant,'central_parcel.staff_dispatched',p_id,jsonb_build_object('offer_ids',ids,'profile_revision',p_revision));
 return jsonb_build_object('dispatch',true,'parcel',komisio_private.central_parcel_json(p_id),'handoverReference','H-'||anchor,'messageId','K'||ref);
end $$;

-- New seller-price requests are booked by staff, including when an old client
-- attempts the previous seller-booking RPC. Existing parcels remain readable.
create function komisio_private.guard_staff_managed_parcel() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.external_item_offers o join public.external_item_requests r on r.id=o.request_id
  where o.id=new.offer_id and r.approval_mode='fixed')
  and not exists(select 1 from public.central_parcels p where p.id=new.parcel_id and p.booked_by=auth.uid()
   and public.tenant_role(p.tenant_id) in ('owner','admin','staff')) then raise exception 'STAFF_BOOKING_REQUIRED'; end if;
 return new;
end $$;
create trigger staff_managed_parcel before insert on public.central_parcel_items for each row execute function komisio_private.guard_staff_managed_parcel();
revoke all on function komisio_private.guard_staff_managed_parcel() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finish_staff_central_parcel(p_id uuid, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); p public.central_parcels; prior public.central_parcel_booking_results;
begin
 perform komisio_private.require_shipping_server();

 select * into p from public.central_parcels where id=p_id and booked_by=uid;
 if coalesce(public.tenant_role(p.tenant_id),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.lock_external_owner(p.owner_id);
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_result is not null and (jsonb_typeof(p_result)<>'object'
  or not(p_result ?& array['bookingId','returnId','trackingId','qrPng'])
  or p_result-array['bookingId','returnId','trackingId','qrPng']<>'{}'::jsonb
  or coalesce(p_result->>'bookingId','') !~ '^[A-Za-z0-9_-]{1,200}$'
  or coalesce(p_result->>'returnId','') !~ '^[A-Za-z0-9_-]{1,128}$'
  or coalesce(p_result->>'trackingId','') !~ '^[A-Za-z0-9]{1,35}$'
  or jsonb_typeof(p_result->'qrPng')<>'string' or length(p_result->>'qrPng')>98304
  or coalesce(p_result->>'qrPng','') !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.central_parcel_booking_results where parcel_id=p_id;
 if found then
  if prior.result is distinct from p_result then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 insert into public.central_parcel_booking_results(parcel_id,tenant_id,owner_id,result) values(p_id,p.tenant_id,p.owner_id,p_result);
 perform komisio_private.record_access(p.tenant_id,'central_parcel.booking_recorded',p_id,jsonb_build_object('confirmed',p_result is not null));
end $function$;

CREATE OR REPLACE FUNCTION public.my_external_item_requests_page(p_offset integer DEFAULT 0, p_id uuid DEFAULT NULL::uuid, p_group text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.external_identity_owner(); result jsonb;
begin
 if p_offset is null or p_offset not between 0 and 100000 or p_group is null or p_group not in ('all','active','history') then raise exception 'INVALID_INPUT'; end if;
 with owned as materialized (
  select r.*,komisio_private.external_request_state(r.id) as lifecycle_status
  from public.external_item_requests r where r.owner_id=uid
 ), classified as materialized (
  select r.*,lifecycle_status in ('waiting','offered','accepted','open','received','registered') as active from owned r
 ), selected as (
  select * from classified r where (p_id is null or r.id=p_id)
   and (p_group='all' or (p_group='active' and active) or (p_group='history' and not active))
  order by created_at desc,id limit 26 offset p_offset
 ), rows as (
  select r.id,r.tenant_id,case when r.sender_country='SE' then 'Komisio' else t.name end as store_name,
   r.description,r.brand,r.condition,r.notes,r.desired_price_ore::text,r.price_basis,r.approval_mode,r.agreement_version_id,r.currency,r.photos,r.created_at,r.sender_country,
   case when d.id is null then 'waiting' else 'declined' end as status,d.note as decline_note,
   r.lifecycle_status as "lifecycleStatus",r.active,
   (r.lifecycle_status='waiting' and r.sender_country='SE') as "canWithdraw"
  from selected r join public.tenants t on t.id=r.tenant_id
  left join public.external_item_request_declines d on d.request_id=r.id
  order by r.created_at desc,r.id limit 25
 )
 select jsonb_build_object('activeCount',(select count(*) from classified where active),'activeLimit',30,
  'historyCount',(select count(*) from classified where not active),'hasMore',(select count(*)>25 from selected),
  'requests',coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc,id) from rows),'[]'::jsonb)) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.read_central_parcel(p_offer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.external_identity_owner(); o public.external_item_offers; p public.central_parcels; booking_row public.central_parcel_booking_results;
begin
 select * into o from public.external_item_offers where id=p_offer and owner_id=uid;
 if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 if exists(select 1 from public.sellers where tenant_id=o.tenant_id and external_owner_id=uid and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 select cp.* into p from public.central_parcels cp join public.central_parcel_items i on i.parcel_id=cp.id where i.offer_id=p_offer and cp.owner_id=uid;
 if found then select * into booking_row from public.central_parcel_booking_results where parcel_id=p.id; end if;
 return jsonb_build_object('staffManaged',exists(select 1 from public.external_item_requests where id=o.request_id and approval_mode='fixed'),'offerId',p_offer,'configured',exists(select 1 from komisio_private.central_shipping_runtime c join public.platform_settings ps on ps.central_app_tenant_id=c.tenant_id where c.tenant_id=o.tenant_id and ps.only_row),'selectionWeightLimitG',(select case when c.service_code='11' then 2500 end from komisio_private.central_shipping_runtime c where c.tenant_id=o.tenant_id),'eligibleItems',coalesce((select jsonb_agg(x.item order by x.created_at,x.offer_id) from (
   select l.offer_id,r.created_at,jsonb_build_object('offerId',l.offer_id,'description',r.description,'selectionWeightG',komisio_private.external_item_selection_weight(r.id),'handoverId',h.id,'reference','H-'||h.reference,'status',h.status) as item
   from public.external_item_handover_links l join public.external_item_offers eo on eo.id=l.offer_id
   join public.external_item_requests r on r.id=eo.request_id join public.seller_handovers h on h.id=l.handover_id
   where l.owner_id=uid and l.tenant_id=o.tenant_id and h.status='open'
    and l.tenant_id=(select central_app_tenant_id from public.platform_settings where only_row)
    and not exists(select 1 from public.central_parcel_items i where i.offer_id=l.offer_id or i.handover_id=l.handover_id)
    and (select count(*) from public.external_item_handover_links same where same.handover_id=h.id)=1
   order by r.created_at,l.offer_id limit 10) x),'[]'::jsonb),'parcel',case when p.id is null then null else
  jsonb_build_object('id',p.id,'reference','P-'||p.reference,'environment',p.environment,'serviceCode',p.service_code,'estimatedWeightG',p.estimated_weight_g,'sender',p.sender,'recipient',p.recipient,
   'weightG',p.weight_g,'lengthMm',p.length_mm,'widthMm',p.width_mm,'heightMm',p.height_mm,
   'status',case when booking_row.parcel_id is null then 'pending' when booking_row.result is null then 'needs_review' else 'booked' end,
   'items',komisio_private.central_parcel_contents(p.id),'booking',booking_row.result,'createdAt',p.created_at) end);
end $function$;
-- Approval is atomic with parcel validation; provider I/O happens after this
-- claim commits. An unconfirmed provider response is never booked again.
create function public.review_central_item_group(p_id uuid,p_tenant uuid,p_owner uuid,p_items jsonb,p_book boolean,p_revision integer,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); entry jsonb; ids uuid[]:='{}'; r public.external_item_requests; o public.external_item_offers;
 ordered jsonb; digest text; previous jsonb; expected numeric; result jsonb;
begin
 if p_id is null or p_tenant is null or p_owner is null or p_book is null or p_revision is null or p_revision<1
  or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_items) not between 1 and 10 then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.lock_external_owner(p_owner);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_agg(x order by x->>'requestId') into ordered from jsonb_array_elements(p_items) x;
 if (select count(distinct x->>'requestId') from jsonb_array_elements(ordered) x)<>jsonb_array_length(ordered) then raise exception 'INVALID_INPUT'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',p_owner,'items',ordered,'book',p_book,'revision',p_revision,'environment',p_environment)::text,'UTF8')),'hex');
 select detail into previous from public.access_events where tenant_id=p_tenant and actor_id=uid and action='central_intake.group_reviewed' and target_id=p_id;
 if found then
  if previous->>'payload_hash' is distinct from digest then raise exception 'REQUEST_CONFLICT'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(previous->'offers');
  if p_book then return public.claim_staff_central_parcel(p_id,p_tenant,p_owner,ids,p_revision,p_environment); end if;
  return jsonb_build_object('id',p_id,'dispatch',false,'parcel',null);
 end if;
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 for entry in select value from jsonb_array_elements(ordered) loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['requestId','expectedSalePriceOre']) or entry-array['requestId','expectedSalePriceOre']<>'{}'
   or coalesce(entry->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(entry->>'expectedSalePriceOre','') !~ '^[1-9][0-9]{0,10}$' then raise exception 'INVALID_INPUT'; end if;
  expected:=(entry->>'expectedSalePriceOre')::numeric;
  select * into r from public.external_item_requests where id=(entry->>'requestId')::uuid and tenant_id=p_tenant and owner_id=p_owner and approval_mode='fixed';
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  select * into o from public.external_item_offers where request_id=r.id order by created_at desc,id limit 1;
  if not found then
   perform public.approve_central_item_request(p_tenant,komisio_private.derived_id(p_id::text||':'||r.id),r.id,expected);
   select * into o from public.external_item_offers where id=komisio_private.derived_id(p_id::text||':'||r.id);
  else
   if o.expected_sale_price_ore<>expected or o.approval_source<>'fixed_request' or komisio_private.external_request_state(r.id,clock_timestamp())<>'open'
    then raise exception 'REQUEST_CHANGED'; end if;
  end if;
  ids:=array_append(ids,o.id);
 end loop;
 if p_book then result:=public.claim_staff_central_parcel(p_id,p_tenant,p_owner,ids,p_revision,p_environment);
 else result:=jsonb_build_object('id',p_id,'dispatch',false,'parcel',null); end if;
 perform komisio_private.record_access(p_tenant,'central_intake.group_reviewed',p_id,jsonb_build_object('payload_hash',digest,'offers',to_jsonb(ids)));
 return result;
end $$;

revoke all on function public.claim_staff_central_parcel(uuid,uuid,uuid,uuid[],integer,text),public.finish_staff_central_parcel(uuid,jsonb),
 public.review_central_item_group(uuid,uuid,uuid,jsonb,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.claim_staff_central_parcel(uuid,uuid,uuid,uuid[],integer,text),public.finish_staff_central_parcel(uuid,jsonb),
 public.review_central_item_group(uuid,uuid,uuid,jsonb,boolean,integer,text) to authenticated;
