CREATE OR REPLACE FUNCTION public.central_request_queue(p_tenant uuid, p_offset integer DEFAULT 0, p_status text DEFAULT 'all'::text, p_query text DEFAULT ''::text, p_owner uuid DEFAULT null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 or p_query is null or length(p_query)>120
  or p_status is null or p_status not in ('all','waiting','offered','accepted','open','received','registered','expired','rejected','declined','cancelled','withdrawn','sold','acquired','ended')
 then raise exception 'INVALID_INPUT'; end if;
 with candidates as materialized (
  select r.*,s.name as seller_name,s.profile_revision as sender_revision,s.profile->'shippingContact' as sender_contact,d.note as decline_note,d.id is not null as declined,
   o.id as offer_id,o.agreement_version_id as offer_agreement_id,
   komisio_private.external_request_state(r.id) as queue_status
  from public.external_item_requests r
  left join public.sellers s on s.tenant_id=r.tenant_id and s.external_owner_id=r.owner_id
  left join public.external_item_request_declines d on d.request_id=r.id
  left join lateral (select x.id,x.agreement_version_id from public.external_item_offers x where x.request_id=r.id order by x.created_at desc,x.id limit 1) o on true
  where r.tenant_id=p_tenant and (p_owner is null or r.owner_id=p_owner)
   and (btrim(p_query)='' or strpos(lower(r.description||' '||r.brand||' '||coalesce(s.name,'')||' '||coalesce(s.profile#>>'{shippingContact,firstName}','')||' '||coalesce(s.profile#>>'{shippingContact,lastName}','')),lower(btrim(p_query)))>0)
 ), filtered as materialized (
  select * from candidates where p_status='all' or queue_status=p_status
 ), selected as (
  select * from filtered order by created_at desc,id limit 50 offset p_offset
 ), rows as (
  select r.id,r.owner_id,r.approval_mode,r.seller_name,r.sender_revision,r.sender_contact,
   (select komisio_private.central_parcel_json(i.parcel_id) from public.central_parcel_items i where i.offer_id=r.offer_id) as parcel,
   komisio_private.external_item_selection_weight(r.id) as selection_weight_g,
   r.description,r.brand,r.condition,r.notes,r.currency,
   case when r.price_basis='seller_amount' then r.desired_price_ore::text end as desired_price_ore,
   r.photos,r.created_at,r.decline_note,r.declined,r.queue_status,
   (select (a.output->>'estimatedWeightG')::integer from public.external_photo_ai_results a where a.id=r.weight_analysis_id and a.tenant_id=p_tenant) as estimated_weight_g,
   coalesce(r.agreement_version_id,r.offer_agreement_id,(select id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1)) as agreement_version_id,
   case when r.offer_id is null then null else public.read_external_item_offer(r.offer_id)-'agreement' end as offer
  from selected r
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc,id) from rows),'[]'::jsonb)) into result;
 return result;
end $function$;

revoke all on function public.central_request_queue(uuid,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.central_request_queue(uuid,integer,text,text,uuid) to authenticated;
