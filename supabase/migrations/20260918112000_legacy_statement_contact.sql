-- Read legacy contact in one MVCC snapshot: a concurrent profile correction
-- cannot fall between reading revision zero and reading the current seller.
create function public.legacy_statement_seller_contact(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select coalesce(v.profile,jsonb_build_object('name',s.name,'email',s.email,'phone',s.phone)) into result
 from public.sellers s left join public.seller_profile_versions v on v.tenant_id=s.tenant_id and v.seller_id=s.id and v.revision=0
 where s.tenant_id=p_tenant and s.id=p_seller;
 if result is null then raise exception 'SELLER_NOT_FOUND'; end if;
 return result - 'notes';
end $$;
revoke all on function public.legacy_statement_seller_contact(uuid,uuid) from public,anon;
grant execute on function public.legacy_statement_seller_contact(uuid,uuid) to authenticated;
