-- Read only the caller's password-presence bit, never a hash or another account.
-- Email confirmation alone cannot distinguish a fresh passwordless activation
-- from an established account. User-editable metadata is not authoritative.
create function public.current_user_has_password() returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 return exists(select 1 from auth.users where id=uid and nullif(encrypted_password,'') is not null);
end $$;
revoke all on function public.current_user_has_password() from public,anon;
grant execute on function public.current_user_has_password() to authenticated;
