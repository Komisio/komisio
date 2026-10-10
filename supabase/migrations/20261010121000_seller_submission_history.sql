-- One snapshot for the page, exact own-account count and an older correction target.
create function public.my_submission_history(p_tenant uuid,p_seller uuid,p_offset integer,p_previous uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_offset is null or p_offset<0 or p_offset>2500000 then raise exception 'INVALID_INPUT'; end if;
 with matches as materialized (
  select s.id,s.created_at from public.seller_submissions s where s.tenant_id=p_tenant and s.seller_id=p_seller
 ), page as (
  select id,created_at from matches order by created_at desc,id desc limit 25 offset p_offset
 ), projected as (
  select s.id,s.previous_id,s.description,s.photos,s.created_at,r.decision,r.note,s.assistance_output,
   s.pricing_mode,s.seller_price::text,s.price_currency,r.price_approved,
   exists(select 1 from public.seller_submissions c where c.tenant_id=p_tenant and c.seller_id=p_seller and c.previous_id=s.id) as has_correction
  from public.seller_submissions s
  left join public.seller_submission_reviews r on r.tenant_id=s.tenant_id and r.submission_id=s.id
  where s.tenant_id=p_tenant and s.seller_id=p_seller
   and (s.id in (select id from page) or (s.id=p_previous and r.decision='more_information'))
 ) select jsonb_build_object(
  'total',(select count(*) from matches),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from projected r join page p on p.id=r.id),'[]'),
  'selected',(select to_jsonb(r) from projected r where r.id=p_previous and r.decision='more_information')
 ) into result;
 return result;
end $$;
revoke all on function public.my_submission_history(uuid,uuid,integer,uuid) from public,anon;
grant execute on function public.my_submission_history(uuid,uuid,integer,uuid) to authenticated;
