-- Seller duplicate check. Before a second record for the same person is
-- created, the counter sees who already matches the contact details typed
-- in: the same e-mail, the same phone number (compared without spaces,
-- dashes and the country prefix), or the same name. A read; the decision
-- to open the existing seller or to register anyway stays with the person
-- and is never taken automatically. Photo duplicates are a separate design
-- (docs/DUPLICATE-CHECK.md).
create function komisio_private.phone_key(p text) returns text
language sql immutable set search_path='' as $$
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p,''),'[^0-9]','','g'),'^00',''),'^46',''),'^0','');
$$;
revoke all on function komisio_private.phone_key(text) from public,anon,authenticated;

create function public.seller_matches(p_tenant uuid,p_name text,p_email text,p_phone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n text:=lower(trim(coalesce(p_name,''))); e text:=lower(trim(coalesce(p_email,''))); k text:=komisio_private.phone_key(p_phone); rows jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(n)>120 or length(e)>254 or length(coalesce(p_phone,''))>40 then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'contact',coalesce(nullif(m.email,''),m.phone),'reasons',to_jsonb(m.reasons))
   order by cardinality(m.reasons) desc,m.name,m.id),'[]'::jsonb) into rows
 from (
  select s.id,s.name,s.email,s.phone,
   array_remove(array[
    case when e<>'' and s.email=e then 'email' end,
    case when k<>'' and komisio_private.phone_key(s.phone)=k then 'phone' end,
    case when n<>'' and lower(s.name)=n then 'name' end],null) as reasons
  from public.sellers s where s.tenant_id=p_tenant
   and ((e<>'' and s.email=e) or (k<>'' and komisio_private.phone_key(s.phone)=k) or (n<>'' and lower(s.name)=n))
  order by cardinality(array_remove(array[
    case when e<>'' and s.email=e then 'email' end,
    case when k<>'' and komisio_private.phone_key(s.phone)=k then 'phone' end,
    case when n<>'' and lower(s.name)=n then 'name' end],null)) desc,s.name,s.id
  limit 5) m;
 return jsonb_build_object('matches',rows);
end $$;
revoke all on function public.seller_matches(uuid,text,text,text) from public,anon;
grant execute on function public.seller_matches(uuid,text,text,text) to authenticated;
