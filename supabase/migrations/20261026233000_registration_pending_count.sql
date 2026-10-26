-- Navigation needs an aggregate, not the queue's applicant contact details.
create function public.pending_seller_registration_count(p_tenant uuid) returns bigint
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select count(*) from public.seller_registrations a
  where a.tenant_id=p_tenant and not exists
   (select 1 from public.seller_registration_reviews r where r.registration_id=a.id));
end $$;
revoke all on function public.pending_seller_registration_count(uuid) from public,anon;
grant execute on function public.pending_seller_registration_count(uuid) to authenticated;
notify pgrst,'reload schema';
