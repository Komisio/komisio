create function public.reception_queue(p_tenant uuid,p_stage text default null,p_before timestamptz default null,p_before_id uuid default null)
returns table(session_id uuid,seller_name text,created_at timestamptz,source_revision integer,review_id uuid,review_version integer,decision text,responded_at timestamptz,stage text,link_state text)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_before is null)<>(p_before_id is null) or (p_stage is not null and p_stage not in ('preparing','needs_review','approved','declined','expired','ready_to_share','link_revoked','awaiting_seller')) then raise exception 'INVALID_INPUT'; end if;
 return query
 select q.* from (
  select s.id, seller.name, s.created_at, coalesce(src.revision,0), r.id as review_id,r.version,
   response.decision,response.created_at as responded_at,
   case when r.id is null then 'preparing'
    when r.source_revision is distinct from src.revision then 'needs_review'
    when response.decision='approve' then 'approved'
    when response.decision='decline' then 'declined'
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
  where s.tenant_id=p_tenant and (p_before is null or (s.created_at,s.id)<(p_before,p_before_id))
 ) q where p_stage is null or q.work_stage=p_stage
 order by q.created_at desc,q.id desc limit 21;
end $$;
revoke all on function public.reception_queue(uuid,text,timestamptz,uuid) from public,anon;
grant execute on function public.reception_queue(uuid,text,timestamptz,uuid) to authenticated;
