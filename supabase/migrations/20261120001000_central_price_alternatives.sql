-- A refusal of the asking price can carry one immutable alternative. A final
-- rejection continues to use external_item_request_declines and cannot reopen.
alter table public.external_item_offers add column alternative_note text
 check (alternative_note is null or (approval_source='seller_response' and length(alternative_note)<=1000));

create or replace function komisio_private.guard_fixed_request_offer() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.external_item_requests;
begin
 select * into strict r from public.external_item_requests where id=new.request_id and tenant_id=new.tenant_id;
 if new.alternative_note is not null then
  if r.approval_mode<>'fixed' or new.approval_source<>'seller_response' or new.seller_amount_ore>=r.desired_price_ore
    or r.agreement_version_id is distinct from new.agreement_version_id or new.previous_offer_id is not null
    then raise exception 'INVALID_INPUT'; end if;
 elsif r.approval_mode='fixed' then
  if new.approval_source<>'fixed_request' or new.seller_amount_ore<>r.desired_price_ore
    or new.agreement_version_id<>r.agreement_version_id or new.previous_offer_id is not null then raise exception 'FIXED_PRICE_REQUIRED'; end if;
 elsif new.approval_source<>'seller_response' then raise exception 'FIXED_PRICE_REQUIRED';
 end if;
 return new;
end $$;

create function public.offer_central_price_alternative(p_tenant uuid,p_id uuid,p_request uuid,p_amount numeric,p_sale_price numeric,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); r public.external_item_requests; prior public.external_item_offers; issued timestamptz;
begin
 if p_id is null or p_amount is null or p_sale_price is null or p_note is null or length(p_note)>1000
   or p_amount not between 1 and 99999999999 or p_sale_price not between 1 and 99999999999
   or p_amount<>trunc(p_amount) or p_sale_price<>trunc(p_sale_price) then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.external_item_requests where id=p_request and tenant_id=p_tenant and approval_mode='fixed';
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform komisio_private.lock_external_owner(r.owner_id);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.external_item_offers where id=p_id;
 if found then
  if prior.request_id<>p_request or prior.tenant_id<>p_tenant or prior.created_by<>actor or prior.alternative_note is distinct from trim(p_note)
    or prior.seller_amount_ore<>p_amount or prior.expected_sale_price_ore<>p_sale_price then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 if komisio_private.external_request_state(p_request,clock_timestamp()) is distinct from 'waiting'
   or exists(select 1 from public.external_item_offers where request_id=p_request) then raise exception 'REQUEST_CHANGED'; end if;
 if not exists(select 1 from public.sellers where id=r.seller_id and tenant_id=p_tenant and external_owner_id=r.owner_id and privacy_closed_at is null) then raise exception 'SELLER_CLOSED'; end if;
 if p_amount>=r.desired_price_ore then raise exception 'INVALID_INPUT'; end if;
 issued:=clock_timestamp();
 insert into public.external_item_offers(id,tenant_id,request_id,owner_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at,alternative_note)
 values(p_id,p_tenant,p_request,r.owner_id,p_amount,p_sale_price,r.agreement_version_id,actor,issued,issued+interval '48 hours',trim(p_note));
 perform komisio_private.record_access(p_tenant,'external_offer.issued',p_id,jsonb_build_object('requestId',p_request,'kind','price_alternative','agreementId',r.agreement_version_id));
 return p_id;
end $$;

-- A response is the consent to the new amount. Reuse the seller and consent
-- captured at submission, including for sellers who chose Swish.
create function komisio_private.link_price_alternative_handover() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.external_item_offers; r public.external_item_requests; h uuid;
begin
 select * into o from public.external_item_offers where id=new.offer_id and alternative_note is not null;
 if not found then return new; end if;
 select * into strict r from public.external_item_requests where id=o.request_id and tenant_id=o.tenant_id and owner_id=new.owner_id;
 if r.owner_id is distinct from auth.uid() or new.agreement_version_id is distinct from r.agreement_version_id
  or o.tenant_id is distinct from (select central_app_tenant_id from public.platform_settings where only_row)
  or not exists(select 1 from public.sellers where id=r.seller_id and tenant_id=o.tenant_id and external_owner_id=r.owner_id and privacy_closed_at is null) then raise exception 'REQUEST_CHANGED'; end if;
 h:=komisio_private.derived_id(o.id::text||':handover');
 insert into public.seller_handovers(id,tenant_id,seller_id,kind,estimated_items,note,created_by)
 values(h,o.tenant_id,r.seller_id,'bag',1,'',new.owner_id);
 insert into public.handover_events(id,tenant_id,handover_id,kind,actor) values(h,o.tenant_id,h,'created',new.owner_id);
 insert into public.external_item_handover_links(id,tenant_id,owner_id,offer_id,seller_id,handover_id,agreement_id,evidence_id,payload_hash)
 values(komisio_private.derived_id(o.id::text||':link'),o.tenant_id,r.owner_id,o.id,r.seller_id,h,r.agreement_version_id,r.consent_evidence_id,
 encode(sha256(convert_to(jsonb_build_object('response',new.id,'offer',o.id,'amount',o.seller_amount_ore,'agreement',r.agreement_version_id)::text,'UTF8')),'hex'));
 return new;
end $$;
create trigger link_price_alternative after insert on public.external_item_offer_responses for each row when (new.accepted)
 execute function komisio_private.link_price_alternative_handover();
revoke all on function komisio_private.link_price_alternative_handover() from public,anon,authenticated;
revoke all on function public.offer_central_price_alternative(uuid,uuid,uuid,numeric,numeric,text) from public,anon;
grant execute on function public.offer_central_price_alternative(uuid,uuid,uuid,numeric,numeric,text) to authenticated;

do $$ declare d text; needle text; sig text; begin
 d:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 needle:='''sellerAmountOre'',offer.seller_amount_ore';
 if strpos(d,needle)=0 then raise exception 'Unexpected offer projection'; end if;
 execute replace(d,needle,'''alternativeNote'',offer.alternative_note,'||needle);
 d:=pg_get_functiondef('komisio_private.guard_staff_managed_parcel()'::regprocedure);
 needle:='o.id=new.offer_id and r.approval_mode=''fixed''';
 if strpos(d,needle)=0 then raise exception 'Unexpected parcel guard'; end if;
 execute replace(d,needle,needle||' and o.alternative_note is null');
 d:=pg_get_functiondef('public.read_central_parcel(uuid)'::regprocedure);
 needle:='id=o.request_id and approval_mode=''fixed''';
 if strpos(d,needle)=0 then raise exception 'Unexpected parcel projection'; end if;
 d:=replace(d,needle,needle||' and o.alternative_note is null');
 needle:='where l.owner_id=uid and l.tenant_id=o.tenant_id and h.status=''open''';
 if strpos(d,needle)=0 then raise exception 'Unexpected parcel selection'; end if;
 execute replace(d,needle,needle||' and (o.alternative_note is null or eo.id=o.id)');
 -- Restrict seller booking of an alternative to its own package, including
 -- old clients calling group booking with additional offer IDs.
 d:=pg_get_functiondef('public.claim_central_parcel_group(uuid,uuid,uuid[],jsonb,text)'::regprocedure);
 needle:='perform komisio_private.lock_external_owner(uid);';
 if strpos(d,needle)=0 then raise exception 'Unexpected booking lock'; end if;
 execute replace(d,needle,needle||' if cardinality(p_offers)>1 and exists(select 1 from public.external_item_offers where owner_id=uid and id=any(p_offers) and alternative_note is not null) then raise exception ''PARCEL_GROUP_UNSUPPORTED''; end if;');
 foreach sig in array array['public.inspect_central_direct_purchase(uuid,uuid,uuid,boolean)','public.confirm_central_receipt_consignment(uuid,uuid)','public.run_central_guarantees(uuid)'] loop
  d:=pg_get_functiondef(sig::regprocedure); needle:='o.approval_source=''fixed_request''';
  if strpos(d,needle)=0 then raise exception 'Unexpected receipt contract: %',sig; end if;
  d:=replace(d,needle,'(o.approval_source=''fixed_request'' or o.alternative_note is not null)');
  if sig like '%inspect_central%' then
   needle:='if not exists(select 1 from public.external_item_offers o join public.external_item_handover_links l';
   if strpos(d,needle)=0 or strpos(d,'l.owner_id=r.owner_id) then')=0 or strpos(d,'r.desired_price_ore')=0 then raise exception 'Unexpected purchase price'; end if;
   d:=replace(d,'receipt uuid; credit uuid;', 'receipt uuid; credit uuid; agreed_amount numeric;');
   d:=replace(d,needle,'select o.seller_amount_ore into agreed_amount from public.external_item_offers o join public.external_item_handover_links l');
   d:=replace(d,'l.owner_id=r.owner_id) then','l.owner_id=r.owner_id; if not found then');
   d:=replace(d,'r.desired_price_ore','agreed_amount');
  end if;
  execute d;
 end loop;
end $$;
create function public.accept_central_price_alternative(p_id uuid,p_offer uuid,p_agreement uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner();
begin
 if not exists(select 1 from public.external_item_offers o where o.id=p_offer and o.owner_id=uid and o.alternative_note is not null
  and o.tenant_id=(select central_app_tenant_id from public.platform_settings where only_row)) then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 return public.respond_external_item_offer(p_id,p_offer,true,p_agreement);
end $$;
revoke all on function public.accept_central_price_alternative(uuid,uuid,uuid) from public,anon;
grant execute on function public.accept_central_price_alternative(uuid,uuid,uuid) to authenticated;

-- Older app builds confirm through onboarding. The saved seller and signed
-- terms are already bound to this request, so never create a second handover.
do $$ declare d text:=pg_get_functiondef('public.complete_external_item_offer(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle text:='select * into prior from public.external_item_handover_links where id=p_id'; begin
 if strpos(d,needle)=0 then raise exception 'Unexpected onboarding contract'; end if;
 execute replace(d,needle,'if offer.alternative_note is not null then return public.accept_central_price_alternative(p_id,p_offer,p_agreement); end if;
 '||needle);
end $$;
notify pgrst,'reload schema';
