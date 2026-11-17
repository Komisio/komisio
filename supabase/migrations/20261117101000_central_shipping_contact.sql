-- #843: reuse immutable profile revisions for the sender's contact details.
create function komisio_private.valid_shipping_contact(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& array['firstName','lastName','phone']
  and v-array['firstName','lastName','phone']='{}'::jsonb
  and jsonb_typeof(v->'firstName')='string' and jsonb_typeof(v->'lastName')='string' and jsonb_typeof(v->'phone')='string'
  and length(trim(v->>'firstName')) between 1 and 58 and length(trim(v->>'lastName')) between 1 and 58
  and length(trim(v->>'firstName')||' '||trim(v->>'lastName'))<=60
  and v->>'phone' ~ '^\+[1-9][0-9]{7,14}$',false);
$$;
revoke all on function komisio_private.valid_shipping_contact(jsonb) from public,anon,authenticated;
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_seller_profile(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_seller_profile(', 'FUNCTION komisio_private.valid_seller_profile_before_shipping(');
end $$;
revoke all on function komisio_private.valid_seller_profile_before_shipping(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_seller_profile(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_seller_profile_before_shipping(p-'shippingContact')
  and (not(p ? 'shippingContact') or komisio_private.valid_shipping_contact(p->'shippingContact')),false);
$$;
create or replace function public.read_my_central_shipping_address() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner(); s public.sellers; a jsonb;
begin
 select * into s from public.sellers where external_owner_id=uid
  and tenant_id=(select central_app_tenant_id from public.platform_settings where only_row);
 if not found then return jsonb_build_object('account',null); end if;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 a:=jsonb_build_object('street',trim(concat_ws(' ',nullif(s.profile->>'addressLine1',''),nullif(s.profile->>'addressLine2',''))),
  'postalCode',s.profile->>'postalCode','city',s.profile->>'city');
 return jsonb_build_object('account',jsonb_build_object('tenantId',s.tenant_id,'sellerId',s.id,'revision',s.profile_revision,
  'contact',s.profile->'shippingContact',
  'address',case when s.profile->>'country'='SE' and komisio_private.valid_parcel_address(a,false) then a else null end));
end $$;
drop function public.save_my_central_shipping_address(uuid,uuid,uuid,integer,jsonb);
create function public.save_my_central_shipping_address(p_id uuid,p_tenant uuid,p_seller uuid,p_expected integer,p_address jsonb,p_contact jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner(); s public.sellers; prior public.seller_profile_versions; original jsonb; updated jsonb;
begin
 if p_id is null or p_tenant is null or p_seller is null or p_expected is null or p_expected<0
  or not komisio_private.valid_parcel_address(p_address,false) or not komisio_private.valid_shipping_contact(p_contact)
  then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 perform 1 from public.tenants where id=p_tenant for update;
 perform komisio_private.external_identity_owner();
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller and external_owner_id=uid for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 select * into prior from public.seller_profile_versions where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.created_by<>uid or prior.revision<>p_expected+1
   or prior.profile->'shippingContact' is distinct from p_contact
   or prior.profile->>'addressLine1' is distinct from p_address->>'street'
   or prior.profile->>'addressLine2' is distinct from '' or prior.profile->>'country' is distinct from 'SE'
   or prior.profile->>'postalCode' is distinct from p_address->>'postalCode' or prior.profile->>'city' is distinct from p_address->>'city'
   or not exists(select 1 from public.access_events where tenant_id=p_tenant and actor_id=uid
    and action='seller.shipping_contact_saved' and target_id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if s.profile_revision<>p_expected then raise exception 'PROFILE_CHANGED'; end if;
 original:=coalesce(s.profile,jsonb_build_object('name',s.name,'email',s.email,'phone',s.phone,
  'addressLine1','','addressLine2','','postalCode','','city','','country','','language','','notes',''));
 updated:=original||jsonb_build_object('addressLine1',p_address->>'street','addressLine2','',
  'postalCode',p_address->>'postalCode','city',p_address->>'city','country','SE','shippingContact',p_contact);
 if not komisio_private.valid_seller_profile(updated) then raise exception 'INVALID_INPUT'; end if;
 if s.profile_revision=0 then
  insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by,created_at)
   values(gen_random_uuid(),p_tenant,p_seller,0,original,s.created_by,s.created_at);
 end if;
 insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by)
  values(p_id,p_tenant,p_seller,p_expected+1,updated,uid);
 update public.sellers set profile=updated,profile_revision=p_expected+1 where tenant_id=p_tenant and id=p_seller;
 perform komisio_private.record_access(p_tenant,'seller.shipping_contact_saved',p_id,jsonb_build_object('seller_id',p_seller,'revision',p_expected+1));
 return p_id;
end $$;
revoke all on function public.save_my_central_shipping_address(uuid,uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_my_central_shipping_address(uuid,uuid,uuid,integer,jsonb,jsonb) to authenticated;

-- Include the exact displayed contact in the request digest and parcel snapshot.
-- Old parcel reads and identical replay payloads remain valid; no sender is rewritten.
create function komisio_private.valid_central_sender_input(v jsonb,p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select komisio_private.valid_parcel_address(v-array['firstName','lastName','phone'],false)
  and (komisio_private.valid_shipping_contact(v-array['street','postalCode','city'])
   or (komisio_private.valid_parcel_address(v,false) and exists(select 1 from public.central_parcels where id=p_id and owner_id=auth.uid())));
$$;
revoke all on function komisio_private.valid_central_sender_input(jsonb,uuid) from public,anon,authenticated;
do $$ declare signature text; definition text; original text; begin
 foreach signature in array array['public.claim_central_parcel(uuid,uuid,jsonb,integer,integer,integer,integer,text)',
  'public.claim_central_parcel_group(uuid,uuid,uuid[],jsonb,text)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(original,'komisio_private.valid_parcel_address(p_address,false)', 'komisio_private.valid_central_sender_input(p_address,p_id)');
  if definition=original then raise exception 'MISSING_SENDER_VALIDATION'; end if;
  original:=definition;
  definition:=replace(definition,'select ''+''||ltrim(u.phone,''+'') into phone from auth.users u where u.id=uid;', 'phone:=p_address->>''phone'';');
  if definition=original then raise exception 'MISSING_AUTH_PHONE_LOOKUP'; end if;
  original:=definition;
  definition:=replace(definition,'sender:=p_address||jsonb_build_object(''name'',s.name,''email'',s.email,''phone'',phone,''country'',''SE'');',
   'sender:=(p_address-array[''firstName'',''lastName''])||jsonb_build_object(''name'',trim(p_address->>''firstName'')||'' ''||trim(p_address->>''lastName''),''email'',s.email,''phone'',phone,''country'',''SE'');');
  if definition=original then raise exception 'MISSING_SENDER_SNAPSHOT'; end if;
  execute definition;
 end loop;
end $$;
