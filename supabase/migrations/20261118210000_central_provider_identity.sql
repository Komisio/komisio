-- A previously phone-created Auth user can have a verified Apple identity but
-- no primary email. Central ownership is Auth-ID based, not an email join.
create function komisio_private.central_identity_email(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select nullif(u.email,'') from auth.users u where u.id=p_user and u.email_confirmed_at is not null),
  (select i.identity_data->>'email' from auth.identities i where i.user_id=p_user
   and i.provider in ('apple','google') and i.identity_data->'email_verified'='true'::jsonb
   and jsonb_typeof(i.identity_data->'email')='string' and length(trim(i.identity_data->>'email'))>0
   order by case i.provider when 'apple' then 0 else 1 end,i.id limit 1))
$$;
revoke all on function komisio_private.central_identity_email(uuid) from public,anon,authenticated;
create or replace function public.external_identity_verified() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid()
  and komisio_private.central_identity_email(u.id) is not null
  and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true')
 and (not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
  or coalesce(auth.jwt()->>'aal','')='aal2');
$$;
create or replace function komisio_private.external_push_session_valid(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
  and komisio_private.central_identity_email(u.id) is not null
  and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true'
  and (not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified') or s.aal='aal2'))
$$;
-- This is a contact default for a new explicitly owned central seller only;
-- it must never join an existing store seller by that address.
do $$ declare definition text; needle text:='select u.email into email from auth.users u where u.id=uid;'; begin
 definition:=pg_get_functiondef('public.save_central_intake_profile(uuid,uuid,uuid,integer,jsonb,jsonb,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_CENTRAL_PROFILE'; end if;
 execute replace(definition,needle,'email:=komisio_private.central_identity_email(uid);');
end $$;
