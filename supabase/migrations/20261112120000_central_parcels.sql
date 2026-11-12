-- Shipping is separate from custody and financial fulfillment. Provision the
-- runtime verifier/address outside migrations; no account secrets live here.
create table komisio_private.central_shipping_runtime (
 singleton boolean primary key default true check(singleton),
 key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'),
 tenant_id uuid not null references public.tenants(id),
 environment text not null check(environment in ('sandbox','production')),
 recipient jsonb not null
);
revoke all on komisio_private.central_shipping_runtime from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate on komisio_private.central_shipping_runtime for each statement execute function komisio_private.guard_support_write();

create function komisio_private.require_shipping_server() returns void
language plpgsql stable security definer set search_path='' as $$
declare token text:=coalesce(current_setting('request.headers',true)::jsonb->>'x-komisio-shipping','');
begin
 if length(token)<>64 or not exists(select 1 from komisio_private.central_shipping_runtime where key_hash=encode(sha256(convert_to(token,'UTF8')),'hex')) then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
end $$;
revoke all on function komisio_private.require_shipping_server() from public,anon,authenticated;

create function komisio_private.valid_parcel_address(v jsonb,full_contact boolean) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='object'
  and v ?& array['street','postalCode','city']
  and jsonb_typeof(v->'street')='string' and length(trim(v->>'street')) between 1 and 50
  and jsonb_typeof(v->'city')='string' and length(trim(v->>'city')) between 1 and 35
  and jsonb_typeof(v->'postalCode')='string' and v->>'postalCode' ~ '^[1-9][0-9]{4}$'
  and case when full_contact then
   v ?& array['name','phone','email','country']
   and v-array['street','postalCode','city','name','phone','email','country']='{}'::jsonb
   and jsonb_typeof(v->'name')='string' and length(trim(v->>'name')) between 1 and 60
   and v->>'country'='SE' and jsonb_typeof(v->'phone')='string' and v->>'phone' ~ '^\+[1-9][0-9]{7,14}$'
   and jsonb_typeof(v->'email')='string' and length(v->>'email')<=70 and v->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  else v-array['street','postalCode','city']='{}'::jsonb end,false);
$$;
revoke all on function komisio_private.valid_parcel_address(jsonb,boolean) from public,anon,authenticated;
alter table komisio_private.central_shipping_runtime add constraint valid_recipient check(komisio_private.valid_parcel_address(recipient,true));

create table public.central_parcels (
 id uuid primary key,
 reference bigint generated always as identity unique check(reference between 1 and 999999999999),
 tenant_id uuid not null references public.tenants(id),
 owner_id uuid not null references auth.users(id),
 sender jsonb not null check(komisio_private.valid_parcel_address(sender,true)),
 recipient jsonb not null check(komisio_private.valid_parcel_address(recipient,true)),
 weight_g integer not null check(weight_g between 1 and 20000),
 length_mm integer not null check(length_mm between 1 and 1500),
 width_mm integer not null check(width_mm between 1 and length_mm),
 height_mm integer not null check(height_mm between 1 and width_mm),
 check(length_mm+2*(width_mm+height_mm)<=3000),
 environment text not null check(environment in ('sandbox','production')),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id,owner_id)
);
-- A separate join preserves a future multi-item package without changing the
-- immutable item/offer or handover models. MVP claims exactly one link.
create table public.central_parcel_items (
 parcel_id uuid not null,
 tenant_id uuid not null,
 owner_id uuid not null,
 offer_id uuid primary key,
 handover_id uuid not null unique,
 foreign key(tenant_id,parcel_id,owner_id) references public.central_parcels(tenant_id,id,owner_id),
 foreign key(tenant_id,offer_id,owner_id) references public.external_item_offers(tenant_id,id,owner_id),
 foreign key(tenant_id,handover_id) references public.seller_handovers(tenant_id,id)
);
-- Claim creation is the at-most-once dispatch boundary. An absent result means
-- unknown outcome, not permission to resend. Provider facts are append-only.
create table public.central_parcel_booking_results (
 parcel_id uuid primary key,
 tenant_id uuid not null,
 owner_id uuid not null,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,parcel_id,owner_id) references public.central_parcels(tenant_id,id,owner_id)
);
do $$ declare t text; begin
 foreach t in array array['central_parcels','central_parcel_items','central_parcel_booking_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_or_staff_read on public.%I for select to authenticated using ((owner_id=auth.uid() and public.external_phone_verified()) or public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function komisio_private.preserve_agreement_record()',t);
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on public.%I for each statement execute function komisio_private.guard_support_write()',t);
  execute format('create trigger plan_gate before insert on public.%I for each row execute function komisio_private.plan_gate()',t);
 end loop;
end $$;

create function public.read_central_parcel(p_offer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); o public.external_item_offers; p public.central_parcels; r public.central_parcel_booking_results;
begin
 select * into o from public.external_item_offers where id=p_offer and owner_id=uid;
 if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 if exists(select 1 from public.sellers where tenant_id=o.tenant_id and external_owner_id=uid and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 select cp.* into p from public.central_parcels cp join public.central_parcel_items i on i.parcel_id=cp.id where i.offer_id=p_offer and cp.owner_id=uid;
 if found then select * into r from public.central_parcel_booking_results where parcel_id=p.id; end if;
 return jsonb_build_object('offerId',p_offer,'configured',exists(select 1 from komisio_private.central_shipping_runtime c join public.platform_settings ps on ps.central_app_tenant_id=c.tenant_id where c.tenant_id=o.tenant_id and ps.only_row),'parcel',case when p.id is null then null else
  jsonb_build_object('id',p.id,'reference','P-'||p.reference,'environment',p.environment,'sender',p.sender,'recipient',p.recipient,
   'weightG',p.weight_g,'lengthMm',p.length_mm,'widthMm',p.width_mm,'heightMm',p.height_mm,
   'status',case when r.parcel_id is null then 'pending' when r.result is null then 'needs_review' else 'booked' end,
   'booking',r.result,'createdAt',p.created_at) end);
end $$;

create function public.claim_central_parcel(p_id uuid,p_offer uuid,p_address jsonb,p_weight integer,p_length integer,p_width integer,p_height integer,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); l public.external_item_handover_links; s public.sellers;
 cfg komisio_private.central_shipping_runtime; prior public.central_parcels; h public.seller_handovers;
 digest text; sender jsonb; phone text; ref bigint;
begin
 perform komisio_private.require_shipping_server();
 if p_id is null or p_offer is null or not komisio_private.valid_parcel_address(p_address,false)
  or p_weight is null or p_weight not between 1 and 20000 or p_length is null or p_length not between 1 and 1500
  or p_width is null or p_width not between 1 and p_length or p_height is null or p_height not between 1 and p_width
  or p_length::bigint+2*(p_width::bigint+p_height)>3000 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into l from public.external_item_handover_links where offer_id=p_offer and owner_id=uid;
 if not found then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 perform 1 from public.tenants where id=l.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into s from public.sellers where tenant_id=l.tenant_id and id=l.seller_id;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('offer',p_offer,'address',p_address,'weight',p_weight,'length',p_length,'width',p_width,'height',p_height)::text,'UTF8')),'hex');
 select * into prior from public.central_parcels where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.tenant_id<>l.tenant_id or prior.payload_hash<>digest then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('dispatch',false,'parcel',public.read_central_parcel(p_offer)->'parcel');
 end if;
 if exists(select 1 from public.central_parcel_items where offer_id=p_offer or handover_id=l.handover_id) then raise exception 'PARCEL_EXISTS'; end if;
 select * into h from public.seller_handovers where tenant_id=l.tenant_id and id=l.handover_id for update;
 if h.status<>'open' then raise exception 'HANDOVER_CLOSED'; end if;
 if (select count(*) from public.external_item_handover_links where handover_id=h.id)<>1 then raise exception 'PARCEL_GROUP_UNSUPPORTED'; end if;
 select * into cfg from komisio_private.central_shipping_runtime where singleton;
 if cfg.tenant_id is distinct from l.tenant_id or cfg.environment is distinct from p_environment
  or l.tenant_id is distinct from (select central_app_tenant_id from public.platform_settings where only_row)
 then raise exception 'SHIPPING_UNAVAILABLE'; end if;
 select '+'||ltrim(u.phone,'+') into phone from auth.users u where u.id=uid;
 sender:=p_address||jsonb_build_object('name',s.name,'email',s.email,'phone',phone,'country','SE');
 if not komisio_private.valid_parcel_address(sender,true) then raise exception 'SHIPPING_CONTACT_UNSUPPORTED'; end if;
 insert into public.central_parcels(id,tenant_id,owner_id,sender,recipient,weight_g,length_mm,width_mm,height_mm,environment,payload_hash)
 values(p_id,l.tenant_id,uid,sender,cfg.recipient,p_weight,p_length,p_width,p_height,cfg.environment,digest) returning reference into ref;
 insert into public.central_parcel_items(parcel_id,tenant_id,owner_id,offer_id,handover_id) values(p_id,l.tenant_id,uid,p_offer,h.id);
 perform komisio_private.record_access(l.tenant_id,'central_parcel.dispatched',p_id,jsonb_build_object('offer_id',p_offer));
 return jsonb_build_object('dispatch',true,'parcel',public.read_central_parcel(p_offer)->'parcel','handoverReference','H-'||h.reference,'messageId','K'||ref);
end $$;

create function public.finish_central_parcel(p_id uuid,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); p public.central_parcels; prior public.central_parcel_booking_results;
begin
 perform komisio_private.require_shipping_server();
 perform komisio_private.lock_external_owner(uid);
 select * into p from public.central_parcels where id=p_id and owner_id=uid;
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
 insert into public.central_parcel_booking_results(parcel_id,tenant_id,owner_id,result) values(p_id,p.tenant_id,uid,p_result);
 perform komisio_private.record_access(p.tenant_id,'central_parcel.booking_recorded',p_id,jsonb_build_object('confirmed',p_result is not null));
end $$;
revoke all on function public.read_central_parcel(uuid),public.claim_central_parcel(uuid,uuid,jsonb,integer,integer,integer,integer,text),public.finish_central_parcel(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_central_parcel(uuid),public.claim_central_parcel(uuid,uuid,jsonb,integer,integer,integer,integer,text),public.finish_central_parcel(uuid,jsonb) to authenticated;

create or replace function public.complete_external_item_offer(p_id uuid,p_offer uuid,p_agreement uuid,p_profile jsonb,p_bank jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); offer public.external_item_offers; prior public.external_item_handover_links;
 seller public.sellers; bank public.seller_bank_versions; evidence uuid; handover uuid; phone text; digest text;
begin
 if p_id is null or p_offer is null or p_agreement is null then raise exception 'INVALID_INPUT'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('offer',p_offer,'agreement',p_agreement,'profile',p_profile,'bank',p_bank)::text,'UTF8')),'hex');
 perform komisio_private.lock_external_owner(uid);
 select * into offer from public.external_item_offers where id=p_offer and owner_id=uid;
 if offer.id is null then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 perform 1 from public.tenants where id=offer.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into prior from public.external_item_handover_links where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.offer_id<>p_offer or prior.payload_hash<>digest then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.external_item_handover_links where offer_id=p_offer) then raise exception 'REQUEST_CHANGED'; end if;
 if p_agreement<>offer.agreement_version_id then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into seller from public.sellers where tenant_id=offer.tenant_id and external_owner_id=uid;
 if seller.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 if seller.id is null and (p_profile is null or p_bank is null) then raise exception 'ACCOUNT_REQUIRED'; end if;
 if p_profile is not null and (jsonb_typeof(p_profile)<>'object' or (p_profile-array['name','email'])<>'{}'
  or not(p_profile ?& array['name','email']) or jsonb_typeof(p_profile->'name')<>'string' or jsonb_typeof(p_profile->'email')<>'string'
  or length(trim(p_profile->>'name')) not between 1 and 120 or length(trim(p_profile->>'email'))>254
  or trim(p_profile->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_INPUT'; end if;
 if p_bank is not null and (not komisio_private.valid_bank_details(p_bank) or p_bank->>'country'<>'SE' or p_bank->>'kind'<>'local'
  or length(trim(p_bank->>'routing'))=0) then raise exception 'INVALID_INPUT'; end if;
 -- Final consent is atomic with account creation. Earlier accepted offers may
 -- complete onboarding later; an unanswered offer must still be within 48h.
 if not exists(select 1 from public.external_item_offer_responses where offer_id=p_offer and accepted) then
  perform public.respond_external_item_offer(komisio_private.derived_id(p_id::text||':response'),p_offer,true,p_agreement);
 end if;
 if seller.id is null then
  select u.phone into phone from auth.users u where u.id=uid;
  insert into public.sellers(id,tenant_id,name,email,phone,created_by,external_owner_id)
  values(komisio_private.derived_id(p_id::text||':seller'),offer.tenant_id,trim(p_profile->>'name'),lower(trim(p_profile->>'email')),phone,uid,uid)
  returning * into seller;
  insert into public.seller_bank_versions(id,tenant_id,seller_id,details,created_by)
  values(komisio_private.derived_id(p_id::text||':bank'),offer.tenant_id,seller.id,p_bank,uid);
  perform komisio_private.record_access(offer.tenant_id,'seller.registered',seller.id,jsonb_build_object('source','central_app'));
 else
  select * into bank from public.seller_bank_versions where tenant_id=offer.tenant_id and seller_id=seller.id order by seq desc limit 1;
  if bank.id is null then raise exception 'ACCOUNT_REQUIRED'; end if;
  if (p_profile is not null and (seller.name<>trim(p_profile->>'name') or seller.email<>lower(trim(p_profile->>'email'))))
   or (p_bank is not null and p_bank<>bank.details) then raise exception 'REQUEST_CHANGED'; end if;
 end if;
 select id into evidence from public.seller_agreement_evidence where tenant_id=offer.tenant_id and seller_id=seller.id
  and agreement_id=p_agreement and recorded_by=uid order by recorded_at,id limit 1;
 if evidence is null then
  evidence:=komisio_private.derived_id(p_id::text||':agreement');
  insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,source)
  values(evidence,offer.tenant_id,p_agreement,seller.id,'Central app offer '||p_offer,uid,'seller_portal');
 end if;
 -- One independently receivable handover per new central offer.
 if handover is null then
  handover:=komisio_private.derived_id(p_id::text||':handover');
  insert into public.seller_handovers(id,tenant_id,seller_id,kind,estimated_items,note,created_by)
  values(handover,offer.tenant_id,seller.id,'bag',1,'',uid);
  insert into public.handover_events(id,tenant_id,handover_id,kind,actor)
  values(handover,offer.tenant_id,handover,'created',uid);
  perform komisio_private.record_access(offer.tenant_id,'handover.created',handover,jsonb_build_object('seller_id',seller.id,'source','central_app'));
 end if;
 insert into public.external_item_handover_links(id,tenant_id,owner_id,offer_id,seller_id,handover_id,agreement_id,evidence_id,payload_hash)
 values(p_id,offer.tenant_id,uid,p_offer,seller.id,handover,p_agreement,evidence,digest);
 return p_id;
end $$;
