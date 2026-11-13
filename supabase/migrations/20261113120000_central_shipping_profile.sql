-- Reuse the existing seller profile and its immutable revision history.
create function public.read_my_central_shipping_address() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); s public.sellers; a jsonb;
begin
 select * into s from public.sellers where external_owner_id=uid
  and tenant_id=(select central_app_tenant_id from public.platform_settings where only_row);
 if not found then return jsonb_build_object('account',null); end if;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 a:=jsonb_build_object('street',trim(concat_ws(' ',nullif(s.profile->>'addressLine1',''),nullif(s.profile->>'addressLine2',''))),
  'postalCode',s.profile->>'postalCode','city',s.profile->>'city');
 return jsonb_build_object('account',jsonb_build_object('tenantId',s.tenant_id,'sellerId',s.id,'revision',s.profile_revision,
  'address',case when s.profile->>'country'='SE' and komisio_private.valid_parcel_address(a,false) then a else null end));
end $$;

create function public.save_my_central_shipping_address(p_id uuid,p_tenant uuid,p_seller uuid,p_expected integer,p_address jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); s public.sellers; prior public.seller_profile_versions; original jsonb; updated jsonb;
begin
 if p_id is null or p_tenant is null or p_seller is null or p_expected is null or p_expected<0
  or not komisio_private.valid_parcel_address(p_address,false) then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 perform 1 from public.tenants where id=p_tenant for update;
 perform komisio_private.external_phone_owner();
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller and external_owner_id=uid for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if s.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 select * into prior from public.seller_profile_versions where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.created_by<>uid or prior.revision<>p_expected+1
   or prior.profile->>'addressLine1' is distinct from p_address->>'street'
   or prior.profile->>'addressLine2' is distinct from '' or prior.profile->>'country' is distinct from 'SE'
   or prior.profile->>'postalCode' is distinct from p_address->>'postalCode'
   or prior.profile->>'city' is distinct from p_address->>'city'
   or not exists(select 1 from public.access_events where tenant_id=p_tenant and actor_id=uid
    and action='seller.shipping_address_saved' and target_id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if s.profile_revision<>p_expected then raise exception 'PROFILE_CHANGED'; end if;
 original:=coalesce(s.profile,jsonb_build_object('name',s.name,'email',s.email,'phone',s.phone,
  'addressLine1','','addressLine2','','postalCode','','city','','country','','language','','notes',''));
 updated:=original||jsonb_build_object('addressLine1',p_address->>'street','addressLine2','',
  'postalCode',p_address->>'postalCode','city',p_address->>'city','country','SE');
 if not komisio_private.valid_seller_profile(updated) then raise exception 'INVALID_INPUT'; end if;
 if s.profile_revision=0 then
  insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by,created_at)
   values(gen_random_uuid(),p_tenant,p_seller,0,original,s.created_by,s.created_at);
 end if;
 insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by)
  values(p_id,p_tenant,p_seller,p_expected+1,updated,uid);
 update public.sellers set profile=updated,profile_revision=p_expected+1 where tenant_id=p_tenant and id=p_seller;
 perform komisio_private.record_access(p_tenant,'seller.shipping_address_saved',p_id,jsonb_build_object('seller_id',p_seller,'revision',p_expected+1));
 return p_id;
end $$;
revoke all on function public.read_my_central_shipping_address(),public.save_my_central_shipping_address(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.read_my_central_shipping_address(),public.save_my_central_shipping_address(uuid,uuid,uuid,integer,jsonb) to authenticated;

-- Unknown measurements remain NULL; no estimates or retrospective corrections.
alter table public.central_parcels alter column weight_g drop not null,
 alter column length_mm drop not null, alter column width_mm drop not null, alter column height_mm drop not null,
 add constraint parcel_measurements_complete check(num_nonnulls(weight_g,length_mm,width_mm,height_mm) in (0,4));
do $$ declare definition text; old_validation text; new_validation text; begin
 definition:=replace(pg_get_functiondef('public.claim_central_parcel(uuid,uuid,jsonb,integer,integer,integer,integer,text)'::regprocedure),chr(13),'');
 old_validation:='or p_weight is null or p_weight not between 1 and 20000 or p_length is null or p_length not between 1 and 1500
  or p_width is null or p_width not between 1 and p_length or p_height is null or p_height not between 1 and p_width';
 new_validation:='or num_nonnulls(p_weight,p_length,p_width,p_height) not in (0,4)
  or p_weight not between 1 and 20000 or p_length not between 1 and 1500
  or p_width not between 1 and p_length or p_height not between 1 and p_width';
 if position(old_validation in definition)=0 then raise exception 'UNEXPECTED_PARCEL_VALIDATION'; end if;
 execute replace(definition,old_validation,new_validation);
end $$;
