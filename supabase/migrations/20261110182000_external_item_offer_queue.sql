create function public.external_item_offer_queue(p_tenant uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); rows jsonb; total bigint;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into total from public.external_item_requests where tenant_id=p_tenant;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') into rows from (
  select r.id,r.owner_id,r.description,r.brand,r.condition,r.notes,r.currency,r.desired_price_ore::text,r.photos,r.created_at,
   d.note as decline_note,d.id is not null as declined,
   coalesce(r.agreement_version_id,o.agreement_version_id,(select id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1)) as agreement_version_id,
   case when o.id is null then null else public.read_external_item_offer(o.id)-'agreement' end as offer
  from public.external_item_requests r
  left join public.external_item_request_declines d on d.request_id=r.id
  left join lateral (select x.id,x.agreement_version_id from public.external_item_offers x where x.request_id=r.id order by x.created_at desc,x.id limit 1) o on true
  where r.tenant_id=p_tenant order by r.created_at desc,r.id limit 25 offset p_offset
 ) q;
 return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function public.external_item_offer_queue(uuid,integer) from public,anon,authenticated;
grant execute on function public.external_item_offer_queue(uuid,integer) to authenticated;
