-- Read-only flow metrics share the same facts and authorization as work queues.
create or replace function public.reception_queue_facts(p_tenant uuid,p_stage text default null,p_before timestamptz default null,p_before_id uuid default null)
returns table(session_id uuid,seller_name text,created_at timestamptz,source_revision integer,review_id uuid,review_version integer,decision text,responded_at timestamptz,stage text,link_state text)
language plpgsql stable security invoker set search_path='' as $$
declare mode text;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_before is null)<>(p_before_id is null) or (p_stage is not null and p_stage not in ('preparing','needs_review','awaiting_custody','ready_to_accept','accepted','declined','expired','ready_to_share','link_revoked','awaiting_seller')) then raise exception 'INVALID_INPUT'; end if;
 mode:=coalesce(public.current_store_policy(p_tenant)->'policy'->>'sellerReviewMode','delegated');
 return query
 select q.* from (
  select s.id, seller.name, s.created_at, coalesce(src.revision,0), r.id as review_id,r.version,
   response.decision,response.created_at as responded_at,
   case when r.id is null then 'preparing'
    when r.source_revision is distinct from src.revision then 'needs_review'
    when item.id is not null then 'accepted'
    when response.decision='decline' then 'declined'
    when mode='delegated' or response.decision='approve' then (case when garment.id is null then 'awaiting_custody' else 'ready_to_accept' end)
    when r.expires_at<=now() then 'expired'
    when access.id is null then 'ready_to_share'
    when access.token_hash is null then 'link_revoked'
    else 'awaiting_seller' end as work_stage,
   case when r.id is null then 'none'
    when r.source_revision is distinct from src.revision then 'stale'
    when r.expires_at<=now() then 'expired'
    when access.id is null then 'none'
    when access.token_hash is null then 'revoked'
    else 'active' end as link_status
  from public.reception_sessions s
  join public.sellers seller on seller.tenant_id=s.tenant_id and seller.id=s.seller_id
  left join lateral (select v.revision from public.reception_source_revisions v where v.tenant_id=s.tenant_id and v.session_id=s.id order by v.revision desc limit 1) src on true
  left join lateral (select v.* from public.reception_reviews v where v.tenant_id=s.tenant_id and v.session_id=s.id order by v.version desc limit 1) r on true
  left join public.reception_responses response on response.tenant_id=s.tenant_id and response.review_id=r.id
  left join lateral (select v.id,v.token_hash from public.reception_access_events v where v.tenant_id=s.tenant_id and v.review_id=r.id order by v.version desc limit 1) access on true
  left join public.garment_receipts garment on garment.tenant_id=s.tenant_id and garment.session_id=s.id
  left join public.items item on item.tenant_id=s.tenant_id and item.origin_kind='reception_review' and item.origin_id=s.id
  where s.tenant_id=p_tenant and (p_before is null or (s.created_at,s.id)<(p_before,p_before_id))
 ) q where p_stage is null or q.work_stage=p_stage
 order by q.created_at desc,q.id desc;
end $$;

revoke all on function public.reception_queue_facts(uuid,text,timestamptz,uuid) from public,anon;
grant execute on function public.reception_queue_facts(uuid,text,timestamptz,uuid) to authenticated;

create or replace function public.reception_queue(p_tenant uuid,p_stage text default null,p_before timestamptz default null,p_before_id uuid default null)
returns table(session_id uuid,seller_name text,created_at timestamptz,source_revision integer,review_id uuid,review_version integer,decision text,responded_at timestamptz,stage text,link_state text)
language sql stable security invoker set search_path='' as $$
 select * from public.reception_queue_facts(p_tenant,p_stage,p_before,p_before_id)
 order by created_at desc,session_id desc limit 21;
$$;

-- A started drop-off is not necessarily finished. No completion is inferred.
create function public.flow_dropoffs(p_tenant uuid,p_state text)
returns setof public.bag_receipts language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_state is null or p_state not in ('unstarted','drafts') then raise exception 'INVALID_INPUT'; end if;
 return query select b.* from public.bag_receipts b where b.tenant_id=p_tenant and
 case when p_state='unstarted' then
 not exists(select 1 from public.inspection_draft_revisions d where d.tenant_id=b.tenant_id and d.bag_id=b.id)
 and not exists(select 1 from public.reception_sessions s where s.tenant_id=b.tenant_id and s.bag_id=b.id)
 else exists(select 1 from public.inspection_draft_revisions d where d.tenant_id=b.tenant_id and d.bag_id=b.id
 and not exists(select 1 from public.items i where i.tenant_id=d.tenant_id and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id)) end;
end $$;
revoke all on function public.flow_dropoffs(uuid,text) from public,anon;
grant execute on function public.flow_dropoffs(uuid,text) to authenticated;

create function public.flow_dropoff_page(p_tenant uuid,p_state text,p_seller uuid,p_reference bigint,p_older bigint,p_newer bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_older is not null and p_newer is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(r.row order by r.sort) from (
 select jsonb_build_object('id',b.id,'seller_id',b.seller_id,'reference',b.reference,'note',b.note,'received_at',b.received_at,'sellers',jsonb_build_object('name',s.name)) as row,
 case when p_newer is null then -b.reference else b.reference end as sort
 from public.flow_dropoffs(p_tenant,p_state) b join public.sellers s on s.tenant_id=b.tenant_id and s.id=b.seller_id
 where (p_seller is null or b.seller_id=p_seller) and (p_reference is null or b.reference=p_reference)
 and (p_older is null or b.reference<p_older) and (p_newer is null or b.reference>p_newer)
 order by 2 limit 21) r),'[]'::jsonb);
end $$;
revoke all on function public.flow_dropoff_page(uuid,text,uuid,bigint,bigint,bigint) from public,anon;
grant execute on function public.flow_dropoff_page(uuid,text,uuid,bigint,bigint,bigint) to authenticated;

create function public.store_flow_snapshot(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare dropoffs jsonb; drafts jsonb; reception jsonb; inventory jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_build_object('count',count(*),'oldest',min(b.received_at)) into dropoffs from public.flow_dropoffs(p_tenant,'unstarted') b;
 select jsonb_build_object('count',count(*),'oldest',min(d.started_at)) into drafts from (
 select v.draft_id,min(v.saved_at) started_at from public.inspection_draft_revisions v where v.tenant_id=p_tenant
 and not exists(select 1 from public.items i where i.tenant_id=v.tenant_id and i.origin_kind='inspection_draft' and i.origin_id=v.draft_id)
 group by v.draft_id) d;
 select coalesce(jsonb_object_agg(q.stage,q.metric),'{}'::jsonb) into reception from (
 select r.stage,jsonb_build_object('count',count(*),'oldest',min(r.created_at)) metric
 from public.reception_queue_facts(p_tenant) r where r.stage<>'accepted' group by r.stage) q;
 select coalesce(jsonb_object_agg(q.stage,q.metric),'{}'::jsonb) into inventory from (
 select komisio_private.item_lifecycle(p_tenant,i.id)->>'stage' stage,
 jsonb_build_object('count',count(*),'oldest',min(i.accepted_at)) metric
 from public.items i where i.tenant_id=p_tenant group by 1) q;
 return jsonb_build_object('asOf',now(),'dropoffs',dropoffs,'drafts',drafts,'reception',reception,'inventory',inventory);
end $$;
revoke all on function public.store_flow_snapshot(uuid) from public,anon;
grant execute on function public.store_flow_snapshot(uuid) to authenticated;
