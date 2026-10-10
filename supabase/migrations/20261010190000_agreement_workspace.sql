-- Read-only, paged acceptance register for an exact store agreement version.
create function public.agreement_sellers(p_tenant uuid,p_agreement uuid,p_query text,p_status text,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_query is null or length(p_query)>120 or p_status is null or p_status not in ('all','accepted','missing')
  or p_offset is null or p_offset<0 or p_offset>25000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant and id=p_agreement) then raise exception 'AGREEMENT_NOT_FOUND'; end if;
 with matching as (
  select s.id,s.name,s.email,s.phone,e.id evidence_id,e.recorded_at,e.source,e.reference
  from public.sellers s left join lateral (
   select ev.id,ev.recorded_at,ev.source,ev.reference from public.seller_agreement_evidence ev
   where ev.tenant_id=p_tenant and ev.seller_id=s.id and ev.agreement_id=p_agreement
   order by ev.recorded_at desc,ev.id desc limit 1
  ) e on true
  where s.tenant_id=p_tenant and (trim(p_query)='' or position(lower(trim(p_query)) in lower(s.name||' '||s.email||' '||s.phone))>0)
   and (p_status='all' or (p_status='accepted' and e.id is not null) or (p_status='missing' and e.id is null))
 ), page as (select * from matching order by lower(name),id limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from matching),'sellers',coalesce((
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,
   'acceptance',case when evidence_id is null then null else jsonb_build_object('id',evidence_id,'at',recorded_at,'source',source,'reference',reference) end) order by lower(name),id) from page
 ),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.agreement_sellers(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.agreement_sellers(uuid,uuid,text,text,integer) to authenticated;

-- Compose existing engine operations; an obsolete agreement rolls back profile
-- changes too. The same request id binds both immutable facts for exact retries.
create function public.save_seller_with_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_expected integer,p_profile jsonb,p_agreement uuid,p_reference text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_agreement is null or p_reference is null or length(trim(p_reference)) not between 1 and 500
  or ((p_seller is null)<>(p_expected is null)) then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.seller_profile_versions where id=p_id)
  and not exists(select 1 from public.seller_agreement_evidence where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 if p_seller is null then
  perform public.register_seller_with_profile(p_tenant,p_id,p_profile);
 else
  perform public.save_seller_profile(p_tenant,p_id,p_seller,p_expected,p_profile);
 end if;
 perform public.record_agreement_evidence(p_tenant,p_id,coalesce(p_seller,p_id),p_agreement,p_reference);
 return p_id;
end $$;
revoke all on function public.save_seller_with_agreement(uuid,uuid,uuid,integer,jsonb,uuid,text) from public,anon;
grant execute on function public.save_seller_with_agreement(uuid,uuid,uuid,integer,jsonb,uuid,text) to authenticated;
