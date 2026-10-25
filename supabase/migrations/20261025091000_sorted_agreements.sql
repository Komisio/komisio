-- Preserve the existing agreement API while adding bounded, ordered reads.
create function public.agreement_sellers_sorted(p_tenant uuid,p_agreement uuid,p_query text,p_status text,p_offset integer,p_sort text,p_direction text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_query is null or length(p_query)>120 or p_status is null or p_status not in ('all','accepted','missing')
  or p_offset is null or p_offset<0 or p_offset>25000000 or p_sort is null or p_sort not in ('name','status','date') or p_direction is null or p_direction not in ('asc','desc') then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant and id=p_agreement) then raise exception 'AGREEMENT_NOT_FOUND'; end if;
 with matching as (
  select s.id,s.name,s.email,s.phone,e.id evidence_id,e.recorded_at,e.source,e.reference,e.translation_id
  from public.sellers s left join lateral (
   select ev.id,ev.recorded_at,ev.source,ev.reference,ev.translation_id from public.seller_agreement_evidence ev
   where ev.tenant_id=p_tenant and ev.seller_id=s.id and ev.agreement_id=p_agreement
   order by ev.recorded_at desc,ev.id desc limit 1
  ) e on true
  where s.tenant_id=p_tenant and (trim(p_query)='' or position(lower(trim(p_query)) in lower(s.name||' '||s.email||' '||s.phone))>0)
   and (p_status='all' or (p_status='accepted' and e.id is not null) or (p_status='missing' and e.id is null))
 ), ranked as (
  select *,row_number() over(order by
   case when p_sort='name' and p_direction='asc' then lower(name) end asc,
   case when p_sort='name' and p_direction='desc' then lower(name) end desc,
   case when p_sort='status' and p_direction='asc' then evidence_id is not null end asc,
   case when p_sort='status' and p_direction='desc' then evidence_id is not null end desc,
   case when p_sort='date' and p_direction='asc' then recorded_at end asc nulls last,
   case when p_sort='date' and p_direction='desc' then recorded_at end desc nulls last,
   lower(name),id) ordinal from matching
 ), page as (select * from ranked order by ordinal limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from matching),'sellers',coalesce((
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,
   'acceptance',case when evidence_id is null then null else jsonb_build_object('id',evidence_id,'at',recorded_at,'source',source,'reference',reference,'translationId',translation_id,'language',coalesce((select language from public.seller_agreement_translations where id=translation_id),(select language from public.seller_agreement_versions where id=p_agreement))) end) order by ordinal) from page
 ),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.agreement_sellers_sorted(uuid,uuid,text,text,integer,text,text) from public,anon;
grant execute on function public.agreement_sellers_sorted(uuid,uuid,text,text,integer,text,text) to authenticated;
