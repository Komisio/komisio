-- The handover summary asked reception_queue_facts for every session in the
-- store and kept only one bag's rows afterwards; PL/pgSQL cannot push that
-- predicate inside. The shared facts query gains an optional bag filter,
-- applied inside its own WHERE, so the summary reads one bag's sessions.
-- Stage and link semantics, ordering, the role check, the bounded limit and
-- every existing caller (positional or defaulted) are unchanged: the new
-- parameter is last and defaults to null, and the old signature is dropped
-- so no overload can be ambiguous.
drop function public.reception_queue_facts(uuid,text,timestamptz,uuid,integer);
create function public.reception_queue_facts(p_tenant uuid,p_stage text default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default null,p_bag uuid default null)
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
  where s.tenant_id=p_tenant and (p_bag is null or s.bag_id=p_bag) and (p_before is null or (s.created_at,s.id)<(p_before,p_before_id))
 ) q where p_stage is null or q.work_stage=p_stage
 order by q.created_at desc,q.id desc limit p_limit;
end $$;
revoke all on function public.reception_queue_facts(uuid,text,timestamptz,uuid,integer,uuid) from public,anon;
grant execute on function public.reception_queue_facts(uuid,text,timestamptz,uuid,integer,uuid) to authenticated;

-- The summary now reads only the bag's sessions. Counts and targets are the same facts as before.
create or replace function public.bag_work_summary(p_tenant uuid,p_bag uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare accepted integer; drafts integer; receptions integer; next_draft uuid; next_reception uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant and (
  (i.origin_kind='inspection_draft' and exists(select 1 from public.inspection_current d where d.tenant_id=p_tenant and d.bag_id=p_bag and d.draft_id=i.origin_id))
  or (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.bag_id=p_bag and s.id=i.origin_id))
 );
 select count(*)::int,(array_agg(d.draft_id order by d.saved_at,d.draft_id))[1] into drafts,next_draft
 from public.inspection_current d where d.tenant_id=p_tenant and d.bag_id=p_bag and not d.archived
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id);
 select count(*)::int,(array_agg(q.session_id order by q.created_at,q.session_id))[1] into receptions,next_reception
 from public.reception_queue_facts(p_tenant,null,null,null,null,p_bag) q
 where q.stage not in ('accepted','declined')
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='reception_review' and i.origin_id=q.session_id);
 return jsonb_build_object('accepted',accepted,'drafts',drafts,'receptions',receptions,'nextDraft',next_draft,'nextReception',next_reception);
end $$;
revoke all on function public.bag_work_summary(uuid,uuid) from public,anon;
grant execute on function public.bag_work_summary(uuid,uuid) to authenticated;
