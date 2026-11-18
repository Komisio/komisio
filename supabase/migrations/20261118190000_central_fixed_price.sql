-- New central submissions carry the seller's binding amount and prior consent.
-- Existing offers, store flows and financial evidence retain their old meaning.
alter table public.external_item_requests
 add column approval_mode text not null default 'offer' check(approval_mode in ('offer','fixed')),
 add column seller_id uuid,
 add column consent_evidence_id uuid,
 add foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 add foreign key(tenant_id,agreement_version_id,seller_id,consent_evidence_id)
 references public.seller_agreement_evidence(tenant_id,agreement_id,seller_id,id),
 add check(approval_mode<>'fixed' or (desired_price_ore is not null and price_basis='seller_amount'
  and currency='SEK' and sender_country='SE' and seller_id is not null and agreement_version_id is not null and consent_evidence_id is not null));
alter table public.external_item_offers add column approval_source text not null default 'seller_response'
 check(approval_source in ('seller_response','fixed_request'));
alter table public.external_item_offer_responses add column approval_actor_id uuid references auth.users(id);

create function public.read_central_intake_profile() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner(); tid uuid; a public.seller_agreement_versions; account jsonb;
begin
 select central_app_tenant_id into tid from public.platform_settings where only_row;
 if tid is null then raise exception 'STORE_UNAVAILABLE'; end if;
 select * into a from public.seller_agreement_versions where tenant_id=tid order by version desc limit 1;
 if a.id is null then raise exception 'AGREEMENT_REQUIRED'; end if;
 account:=public.read_my_central_shipping_address()->'account';
 return jsonb_build_object('tenantId',tid,'account',account,'agreement',jsonb_build_object('id',a.id,'version',a.version,'title',a.title,'body',a.body,'language',a.language),
  'agreementAccepted',exists(select 1 from public.seller_agreement_evidence e join public.sellers s on s.id=e.seller_id and s.tenant_id=e.tenant_id
   where s.tenant_id=tid and s.external_owner_id=uid and e.agreement_id=a.id and e.recorded_by=uid and e.source='seller_portal'));
end $$;

create function public.save_central_intake_profile(p_id uuid,p_tenant uuid,p_agreement uuid,p_expected integer,p_address jsonb,p_contact jsonb,p_accept boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner(); s public.sellers; agreement uuid; email text; digest text; previous jsonb; consent uuid;
begin
 if p_id is null or p_tenant is null or p_agreement is null or p_expected is null or p_expected < -1 or p_accept is null
  or not komisio_private.valid_parcel_address(p_address,false) or not komisio_private.valid_shipping_contact(p_contact) then raise exception 'INVALID_INPUT'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('tenant',p_tenant,'agreement',p_agreement,'expected',p_expected,'address',p_address,'contact',p_contact,'accept',p_accept)::text,'UTF8')),'hex');
 perform komisio_private.lock_external_owner(uid);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 perform komisio_private.external_identity_owner();
 select detail into previous from public.access_events where tenant_id=p_tenant and actor_id=uid and action='central_intake.profile_saved' and target_id=p_id;
 if found then
  if previous->>'payload_hash' is distinct from digest then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and external_owner_id=uid for update;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 select e.id into consent from public.seller_agreement_evidence e where e.tenant_id=p_tenant and e.seller_id=s.id
  and e.agreement_id=p_agreement and e.recorded_by=uid and e.source='seller_portal' order by e.recorded_at,e.id limit 1;
 if consent is null and not p_accept then raise exception 'AGREEMENT_REQUIRED'; end if;
 if s.id is null then
  if p_expected<>-1 then raise exception 'PROFILE_CHANGED'; end if;
  select u.email into email from auth.users u where u.id=uid;
  if length(email)>70 then raise exception 'SHIPPING_CONTACT_UNSUPPORTED'; end if;
  insert into public.sellers(id,tenant_id,name,email,phone,created_by,external_owner_id)
  values(komisio_private.derived_id(p_id::text||':seller'),p_tenant,trim(p_contact->>'firstName')||' '||trim(p_contact->>'lastName'),email,p_contact->>'phone',uid,uid) returning * into s;
  perform komisio_private.record_access(p_tenant,'seller.registered',s.id,jsonb_build_object('source','central_app'));
 elsif s.profile_revision<>p_expected then raise exception 'PROFILE_CHANGED';
 end if;
 perform public.save_my_central_shipping_address(p_id,p_tenant,s.id,s.profile_revision,p_address,p_contact);
 if consent is null then
  consent:=komisio_private.derived_id(p_id::text||':agreement');
  insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,source)
  values(consent,p_tenant,p_agreement,s.id,'Central app submission',uid,'seller_portal');
 end if;
 perform komisio_private.record_access(p_tenant,'central_intake.profile_saved',p_id,jsonb_build_object('seller_id',s.id,'agreement_id',p_agreement,'payload_hash',digest));
 return p_id;
end $$;

CREATE OR REPLACE FUNCTION public.submit_central_item_request(p_id uuid, p_tenant uuid, p_description text, p_brand text, p_condition text, p_notes text, p_price_ore numeric, p_currency text, p_photos uuid[], p_sender_country text, p_price_basis text, p_agreement uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.external_identity_owner(); prior public.external_item_requests; policy jsonb; seller public.sellers; evidence uuid; agreement uuid;
 d text:=btrim(p_description); b text:=btrim(p_brand); n text:=btrim(p_notes);
begin
 if p_price_ore is null then raise exception 'PRICE_REQUIRED'; end if;
 if p_agreement is null or p_price_basis is distinct from 'seller_amount' then raise exception 'INVALID_INPUT'; end if;
 if p_price_basis is null or p_price_basis not in ('resale','seller_amount') or p_id is null or p_tenant is null or d is null or length(d) not between 1 and 160
  or b is null or length(b)>100 or n is null or length(n)>1000
  or p_condition is null or p_condition not in ('like_new','very_good','good','worn')
  or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  or (p_price_ore is not null and (p_price_ore<1 or p_price_ore>99999999999 or p_price_ore<>trunc(p_price_ore)))
  or p_photos is null or cardinality(p_photos) not between 1 and 8
  or array_ndims(p_photos)<>1 or array_lower(p_photos,1)<>1
  or (select count(distinct x) from unnest(p_photos) x)<>cardinality(p_photos)
 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into prior from public.external_item_requests where id=p_id;
 if found then
  if prior.approval_mode<>'fixed' or prior.agreement_version_id is distinct from p_agreement or prior.owner_id<>uid or prior.tenant_id<>p_tenant or prior.description<>d or prior.brand<>b
   or prior.condition<>p_condition or prior.notes<>n or prior.desired_price_ore is distinct from p_price_ore
   or prior.price_basis<>p_price_basis or prior.currency<>p_currency or prior.photos<>p_photos or prior.sender_country is distinct from p_sender_country then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_sender_country is distinct from 'SE' then raise exception 'SWEDEN_REQUIRED'; end if;
 if p_currency<>'SEK' then raise exception 'STORE_CHANGED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 -- Recheck currency under the same tenant lock used for policy publication.
 perform 1 from public.tenants where id=p_tenant for update;
 select v.policy into policy from public.store_policy_versions v where tenant_id=p_tenant order by version desc limit 1;
 if coalesce(policy->>'currency','SEK')<>p_currency then raise exception 'STORE_CHANGED'; end if;
 if (select count(*) from public.external_item_requests r where owner_id=uid
   and komisio_private.external_request_active(r.id))>=30 then raise exception 'ACTIVE_REQUEST_LIMIT'; end if;
 if (select count(*) from public.external_item_photos p where p.id=any(p_photos) and p.owner_id=uid and p.discarded_at is null
  and exists(select 1 from storage.objects o where o.bucket_id='external-item-photos' and o.name=p.path))<>cardinality(p_photos)
 then raise exception 'PHOTO_NOT_FOUND'; end if;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into seller from public.sellers where tenant_id=p_tenant and external_owner_id=uid;
 if seller.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 if seller.id is null or not komisio_private.valid_shipping_contact(seller.profile->'shippingContact')
  or seller.profile->>'country' is distinct from 'SE' or not komisio_private.valid_parcel_address(jsonb_build_object('street',seller.profile->>'addressLine1','postalCode',seller.profile->>'postalCode','city',seller.profile->>'city'),false)
 then raise exception 'ACCOUNT_REQUIRED'; end if;
 select id into evidence from public.seller_agreement_evidence where tenant_id=p_tenant and seller_id=seller.id
  and agreement_id=p_agreement and recorded_by=uid and source='seller_portal' order by recorded_at,id limit 1;
 if evidence is null then raise exception 'AGREEMENT_REQUIRED'; end if;
 insert into public.external_item_requests(id,owner_id,tenant_id,description,brand,condition,notes,desired_price_ore,currency,photos,sender_country,price_basis,approval_mode,seller_id,consent_evidence_id)
 values(p_id,uid,p_tenant,d,b,p_condition,n,p_price_ore,p_currency,p_photos,p_sender_country,p_price_basis,'fixed',seller.id,evidence);
 return p_id;
end $function$;


-- Separate staff acceptance of a seller's request from a later seller response.
create function komisio_private.guard_fixed_request_offer() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.external_item_requests;
begin
 select * into r from public.external_item_requests where id=new.request_id and tenant_id=new.tenant_id;
 if r.approval_mode='fixed' then
  if new.approval_source<>'fixed_request' or new.seller_amount_ore<>r.desired_price_ore
   or new.agreement_version_id<>r.agreement_version_id or new.previous_offer_id is not null
   then raise exception 'FIXED_PRICE_REQUIRED'; end if;
 elsif new.approval_source<>'seller_response' then raise exception 'FIXED_PRICE_REQUIRED';
 end if;
 return new;
end $$;
create trigger fixed_request_offer before insert on public.external_item_offers
 for each row execute function komisio_private.guard_fixed_request_offer();
create function komisio_private.guard_fixed_request_response() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.external_item_offers;
begin
 select * into o from public.external_item_offers where id=new.offer_id;
 if o.approval_source='fixed_request' then
  if not new.accepted or new.approval_actor_id is distinct from auth.uid() or new.approval_actor_id is distinct from o.created_by
   or new.agreement_version_id is distinct from o.agreement_version_id
   or coalesce(public.tenant_role(o.tenant_id),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 elsif new.approval_actor_id is not null then raise exception 'INVALID_INPUT';
 end if;
 return new;
end $$;
create trigger fixed_request_response before insert on public.external_item_offer_responses
 for each row execute function komisio_private.guard_fixed_request_response();

create function public.approve_central_item_request(p_tenant uuid,p_id uuid,p_request uuid,p_sale_price_ore numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); r public.external_item_requests; prior public.external_item_offers;
 issued timestamptz; handover uuid; link uuid;
begin
 if p_id is null or p_tenant is null or p_request is null or p_sale_price_ore is null
  or p_sale_price_ore not between 1 and 99999999999 or p_sale_price_ore<>trunc(p_sale_price_ore) then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.external_item_requests where id=p_request and tenant_id=p_tenant;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform komisio_private.lock_external_owner(r.owner_id);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.external_item_offers where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.request_id<>p_request or prior.created_by<>uid
   or prior.expected_sale_price_ore<>p_sale_price_ore or prior.approval_source<>'fixed_request' then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 if r.approval_mode<>'fixed' then raise exception 'FIXED_PRICE_REQUIRED'; end if;
 if komisio_private.external_request_state(r.id,clock_timestamp()) is distinct from 'waiting' then raise exception 'REQUEST_CHANGED'; end if;
 if not exists(select 1 from public.sellers where id=r.seller_id and tenant_id=p_tenant and external_owner_id=r.owner_id and privacy_closed_at is null)
 then raise exception 'SELLER_CLOSED'; end if;
 issued:=clock_timestamp();
 insert into public.external_item_offers(id,tenant_id,request_id,owner_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at,approval_source)
 values(p_id,p_tenant,p_request,r.owner_id,r.desired_price_ore,p_sale_price_ore,r.agreement_version_id,uid,issued,issued+interval '48 hours','fixed_request');
 insert into public.external_item_offer_responses(id,tenant_id,offer_id,owner_id,accepted,agreement_version_id,approval_actor_id)
 values(komisio_private.derived_id(p_id::text||':approval'),p_tenant,p_id,r.owner_id,true,r.agreement_version_id,uid);
 handover:=komisio_private.derived_id(p_id::text||':handover');
 insert into public.seller_handovers(id,tenant_id,seller_id,kind,estimated_items,note,created_by)
 values(handover,p_tenant,r.seller_id,'bag',1,'',uid);
 insert into public.handover_events(id,tenant_id,handover_id,kind,actor) values(handover,p_tenant,handover,'created',uid);
 link:=komisio_private.derived_id(p_id::text||':link');
 insert into public.external_item_handover_links(id,tenant_id,owner_id,offer_id,seller_id,handover_id,agreement_id,evidence_id,payload_hash)
 values(link,p_tenant,r.owner_id,p_id,r.seller_id,handover,r.agreement_version_id,r.consent_evidence_id,
  encode(sha256(convert_to(jsonb_build_object('request',r.id,'amount',r.desired_price_ore,'agreement',r.agreement_version_id,'evidence',r.consent_evidence_id)::text,'UTF8')),'hex'));
 perform komisio_private.record_access(p_tenant,'external_request.approved',p_id,jsonb_build_object('request_id',r.id,'handover_id',handover));
 return p_id;
end $$;

revoke all on function komisio_private.guard_fixed_request_offer(),komisio_private.guard_fixed_request_response() from public,anon,authenticated;
revoke all on function public.read_central_intake_profile(),public.save_central_intake_profile(uuid,uuid,uuid,integer,jsonb,jsonb,boolean),
 public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid),
 public.approve_central_item_request(uuid,uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.read_central_intake_profile(),public.save_central_intake_profile(uuid,uuid,uuid,integer,jsonb,jsonb,boolean),
 public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid),
 public.approve_central_item_request(uuid,uuid,uuid,numeric) to authenticated;
