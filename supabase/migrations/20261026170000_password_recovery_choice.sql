-- Sending a recovery email cannot lock out an account. Only Auth consuming its
-- recovery token records the UI requirement; only a real password change clears it.
create function komisio_private.track_password_recovery_choice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if nullif(old.recovery_token,'') is not null and nullif(new.recovery_token,'') is null
  and old.recovery_sent_at is not null then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('komisio_password_recovery_pending',true);
 end if;
 if new.email_confirmed_at is not null and new.encrypted_password is distinct from old.encrypted_password
  and nullif(new.encrypted_password,'') is not null then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)-'komisio_password_recovery_pending';
 end if;
 return new;
end $$;
revoke all on function komisio_private.track_password_recovery_choice() from public,anon,authenticated;
create trigger komisio_password_recovery_choice before update of recovery_token,encrypted_password on auth.users
 for each row execute function komisio_private.track_password_recovery_choice();
