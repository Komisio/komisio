-- Auth also clears recovery_token for magic links and refreshes provider metadata
-- from its in-memory user. Start recovery only from the verified session method.
drop trigger komisio_password_recovery_choice on auth.users;
create or replace function komisio_private.track_password_recovery_choice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.raw_app_meta_data->>'komisio_password_recovery_pending'='true' then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('komisio_password_recovery_pending',true);
 end if;
 if new.email_confirmed_at is not null and new.encrypted_password is distinct from old.encrypted_password
  and nullif(new.encrypted_password,'') is not null then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)-'komisio_password_recovery_pending';
 end if;
 return new;
end $$;
create trigger komisio_password_recovery_choice before update of raw_app_meta_data,encrypted_password on auth.users
 for each row execute function komisio_private.track_password_recovery_choice();

create function komisio_private.start_password_recovery_choice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.authentication_method='recovery' then
  update auth.users u set raw_app_meta_data=coalesce(u.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('komisio_password_recovery_pending',true)
   from auth.sessions s where s.id=new.session_id and u.id=s.user_id;
 end if;
 return new;
end $$;
revoke all on function komisio_private.start_password_recovery_choice() from public,anon,authenticated;
create trigger komisio_password_recovery_session after insert on auth.mfa_amr_claims
 for each row when(new.authentication_method='recovery') execute function komisio_private.start_password_recovery_choice();
