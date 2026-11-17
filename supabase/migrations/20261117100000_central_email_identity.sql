-- #843: authenticated ownership is unchanged; verified email replaces phone.
-- Renaming preserves policy dependencies and existing grants by OID.
alter function public.external_phone_verified() rename to external_identity_verified;
alter function komisio_private.external_phone_owner() rename to external_identity_owner;
do $$ declare f record; definition text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','komisio_private') and p.prokind='f'
   and (p.prosrc like '%external_phone_verified%' or p.prosrc like '%external_phone_owner%' or p.prosrc like '%PHONE_VERIFICATION_REQUIRED%') loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(replace(replace(definition,'external_phone_verified','external_identity_verified'),
   'external_phone_owner','external_identity_owner'),'PHONE_VERIFICATION_REQUIRED','AUTH_REQUIRED');
  execute definition;
 end loop;
end $$;
create or replace function public.external_identity_verified() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null
  and nullif(email,'') is not null and deleted_at is null and not coalesce(is_anonymous,false)
  and coalesce(raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true')
 and (not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
  or coalesce(auth.jwt()->>'aal','')='aal2');
$$;
create or replace function komisio_private.external_push_session_valid(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
  and u.email_confirmed_at is not null and nullif(u.email,'') is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true'
  and (not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified') or s.aal='aal2'))
$$;
-- A contact number is supplied later for shipping; Auth phone is no longer used.
do $$ declare signature text; definition text; begin
 foreach signature in array array[
  'public.complete_external_item_offer(uuid,uuid,uuid,jsonb,jsonb)',
  'public.read_external_item_onboarding(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'select u.phone into phone from auth.users u where u.id=uid;', 'phone:='''';');
  execute definition;
 end loop;
end $$;
