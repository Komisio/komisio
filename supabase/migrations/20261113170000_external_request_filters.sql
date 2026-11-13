-- Display-state projection only. Legacy readers and all mutation boundaries stay intact.
create function public.external_item_offer_queue_filtered(
 p_tenant uuid, p_offset integer default 0, p_status text default 'all', p_query text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); result jsonb; at_time timestamptz:=clock_timestamp();
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_offset is null or p_offset not between 0 and 100000 or p_query is null or length(p_query)>120
  or p_status is null or p_status not in ('all','waiting','offered','accepted','open','received','registered','expired','rejected','declined','cancelled') then
  raise exception 'INVALID_INPUT';
 end if;
 with candidates as materialized (
  select r.*, d.note as decline_note, d.id is not null as declined,
   o.id as offer_id, o.agreement_version_id as offer_agreement_id,
   case when a.id is not null and not a.accepted then 'declined'
    when d.id is not null then 'rejected'
    when exists(select 1 from public.external_item_guarantees g
      join public.external_item_guarantee_events e on e.guarantee_id=g.id and e.tenant_id=g.tenant_id and e.kind='registered'
      where g.offer_id=o.id and g.tenant_id=p_tenant) then 'registered'
    when h.id is not null then h.status
    when a.accepted then 'accepted'
    when a.id is not null then 'declined'
    when o.id is null then 'waiting'
    when o.expires_at<=at_time then 'expired'
    else 'offered' end as queue_status
  from public.external_item_requests r
  left join public.external_item_request_declines d on d.request_id=r.id and d.tenant_id=r.tenant_id
  left join lateral (select x.id,x.agreement_version_id,x.expires_at from public.external_item_offers x
    where x.request_id=r.id and x.tenant_id=r.tenant_id order by x.created_at desc,x.id limit 1) o on true
  left join public.external_item_offer_responses a on a.offer_id=o.id and a.tenant_id=r.tenant_id
  left join public.external_item_handover_links l on l.offer_id=o.id and l.tenant_id=r.tenant_id
  left join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=r.tenant_id
  where r.tenant_id=p_tenant
   and (btrim(p_query)='' or strpos(lower(r.description||' '||r.brand),lower(btrim(p_query)))>0)
 ), filtered as materialized (
  select * from candidates where p_status='all' or queue_status=p_status
 ), selected as (
  select * from filtered order by created_at desc,id limit 25 offset p_offset
 ), rows as (
  select r.id,r.owner_id,r.description,r.brand,r.condition,r.notes,r.currency,
   case when r.price_basis='seller_amount' then r.desired_price_ore::text end as desired_price_ore,
   r.photos,r.created_at,r.decline_note,r.declined,r.queue_status,
   coalesce(r.agreement_version_id,r.offer_agreement_id,(select id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1)) as agreement_version_id,
   case when r.offer_id is null then null else public.read_external_item_offer(r.offer_id)-'agreement' end as offer
  from selected r
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',
   coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc,id) from rows),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.external_item_offer_queue_filtered(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.external_item_offer_queue_filtered(uuid,integer,text,text) to authenticated;
