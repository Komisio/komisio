create or replace function public.my_item_submissions(p_tenant uuid,p_seller uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into result from (
  select s.id,s.previous_id,s.description,s.photos,s.created_at,r.decision,r.note,s.assistance_output
  from public.seller_submissions s left join public.seller_submission_reviews r on r.submission_id=s.id
  where s.tenant_id=p_tenant and s.seller_id=p_seller and (p_before is null or s.created_at<p_before)
  order by s.created_at desc,s.id limit 50
 ) x;
 return result;
end $$;
