-- OTP signup creates an unknown random password. Hash presence alone therefore
-- cannot establish whether a seller has chosen their own password.
-- The signup hint only selects onboarding; it never grants account access.
create function komisio_private.track_activation_password_setup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.email_confirmed_at is null and new.raw_user_meta_data->>'komisio_activation_signup'='true' then
   new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('komisio_password_setup_pending',true);
  end if;
 elsif old.email_confirmed_at is not null
   and new.encrypted_password is distinct from old.encrypted_password
   and nullif(new.encrypted_password,'') is not null then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)-'komisio_password_setup_pending';
 end if;
 return new;
end $$;
revoke all on function komisio_private.track_activation_password_setup() from public,anon,authenticated;
create trigger komisio_activation_password_setup
 before insert or update of encrypted_password on auth.users
 for each row execute function komisio_private.track_activation_password_setup();

-- Preserve unfinished activations sent before the signup hint was introduced.
-- Already confirmed accounts are deliberately left unchanged.
update auth.users u
 set raw_app_meta_data=coalesce(u.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('komisio_password_setup_pending',true)
 where u.email_confirmed_at is null and exists(
  select 1 from public.seller_communications c
  where c.recipient=lower(trim(u.email)) and c.template_key='seller.welcome'
    and c.activation_claimed_at is not null
 );

create or replace function public.current_user_has_password() returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 return exists(select 1 from auth.users where id=uid
  and nullif(encrypted_password,'') is not null
  and coalesce(raw_app_meta_data->>'komisio_password_setup_pending','false')<>'true');
end $$;
