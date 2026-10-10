-- Seller-owned evidence grants historical reads, never acceptance of stale terms.
create function public.my_seller_agreement_archive(p_tenant uuid,p_seller uuid,p_version uuid,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest uuid; agreement public.seller_agreement_versions; evidence public.seller_agreement_evidence; history jsonb; total bigint;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_offset is null or p_offset<0 or p_offset>2000000 then raise exception 'INVALID_INPUT'; end if;
 select id into latest from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select * into agreement from public.seller_agreement_versions a
 where a.tenant_id=p_tenant and a.id=coalesce(p_version,latest)
  and (a.id=latest or exists(select 1 from public.seller_agreement_evidence e
   where e.tenant_id=p_tenant and e.seller_id=p_seller and e.agreement_id=a.id));
 select * into evidence from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=agreement.id order by recorded_at desc,id desc limit 1;
 with accepted as materialized (
  select a.id,a.version,a.title,e.recorded_at as at,e.source
  from public.seller_agreement_versions a
  join lateral (select recorded_at,source from public.seller_agreement_evidence
   where tenant_id=p_tenant and seller_id=p_seller and agreement_id=a.id order by recorded_at desc,id desc limit 1) e on true
  where a.tenant_id=p_tenant
 ), page as (select * from accepted order by version desc limit 20 offset p_offset)
 select (select count(*) from accepted),coalesce((select jsonb_agg(to_jsonb(p) order by p.version desc) from page p),'[]'::jsonb) into total,history;
 return jsonb_build_object(
  'agreement',case when agreement.id is null then null else jsonb_build_object('id',agreement.id,'version',agreement.version,'title',agreement.title,'body',agreement.body,'language',agreement.language) end,
  'acceptance',case when evidence.id is null then null else jsonb_build_object('id',evidence.id,'at',evidence.recorded_at,'source',evidence.source) end,
  'current',coalesce(agreement.id=latest,false),'history',history,'total',total);
end $$;
revoke all on function public.my_seller_agreement_archive(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.my_seller_agreement_archive(uuid,uuid,uuid,integer) to authenticated;
