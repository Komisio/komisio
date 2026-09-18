-- New statements freeze the public contact/address and chosen document language.
-- Internal staff notes never enter the statement snapshot.
create or replace function komisio_private.statement_seller_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.sellers; language text;
begin
 if tg_op='INSERT' then
  select * into s from public.sellers where tenant_id=new.tenant_id and id=new.seller_id;
  language:=nullif(s.profile->>'language','');
  if language is null then select profile->>'language' into language from public.store_profile_versions where tenant_id=new.tenant_id order by version desc limit 1; end if;
  new.seller_contact:=jsonb_build_object('name',s.name,'email',s.email,'phone',s.phone,
    'addressLine1',coalesce(s.profile->>'addressLine1',''),'addressLine2',coalesce(s.profile->>'addressLine2',''),
    'postalCode',coalesce(s.profile->>'postalCode',''),'city',coalesce(s.profile->>'city',''),
    'country',coalesce(s.profile->>'country',''),'language',coalesce(language,''));
 elsif new.seller_contact is distinct from old.seller_contact then raise exception 'IMMUTABLE_STATEMENT' using errcode='55000';
 end if;
 return new;
end $$;
