-- Work filters operate before paging. A prepared reception is not an accepted item.
create function public.submission_queue(p_tenant uuid,p_filter text,p_query text,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_filter is null or p_filter not in ('all','pending','invited','registered')
  or p_query is null or length(p_query)>100 or p_offset is null or p_offset<0 or p_offset>2500000 then raise exception 'INVALID_INPUT'; end if;
 with matches as materialized (
  select s.id,s.created_at,i.id as item_id
  from public.seller_submissions s
  join public.sellers seller on seller.tenant_id=s.tenant_id and seller.id=s.seller_id
  left join public.seller_submission_reviews r on r.tenant_id=s.tenant_id and r.submission_id=s.id
  left join public.submission_receptions sr on sr.tenant_id=s.tenant_id and sr.submission_id=s.id
  left join public.items i on i.tenant_id=s.tenant_id and i.origin_kind='reception_review' and i.origin_id=sr.session_id
  where s.tenant_id=p_tenant
   and (p_filter='all' or (p_filter='pending' and r.id is null)
    or (p_filter='invited' and r.decision='invite' and i.id is null)
    or (p_filter='registered' and i.id is not null))
   and (trim(p_query)='' or strpos(lower(s.description),lower(trim(p_query)))>0
    or strpos(lower(seller.name),lower(trim(p_query)))>0 or s.id::text=lower(trim(p_query)))
 ), page as (
  select * from matches order by created_at desc,id desc limit 25 offset p_offset
 ), rows as (
  select s.id,s.seller_id,s.description,s.photos,s.created_at,s.assistance_output,s.pricing_mode,s.seller_price,s.price_currency,
   jsonb_build_object('name',seller.name) as sellers,p.item_id,
   case when r.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',r.id,'decision',r.decision,'note',r.note,'price_approved',r.price_approved)) end as seller_submission_reviews,
   case when sr.session_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('session_id',sr.session_id)) end as submission_receptions
  from page p join public.seller_submissions s on s.tenant_id=p_tenant and s.id=p.id
  join public.sellers seller on seller.tenant_id=s.tenant_id and seller.id=s.seller_id
  left join public.seller_submission_reviews r on r.tenant_id=s.tenant_id and r.submission_id=s.id
  left join public.submission_receptions sr on sr.tenant_id=s.tenant_id and sr.submission_id=s.id
 ) select jsonb_build_object('total',(select count(*) from matches),'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from rows r),'[]')) into result;
 return result;
end $$;
revoke all on function public.submission_queue(uuid,text,text,integer) from public,anon;
grant execute on function public.submission_queue(uuid,text,text,integer) to authenticated;
