-- Invoker reads use tenant_role and existing RLS, which enforce verified sessions and MFA.
-- Read existing handover facts without introducing a completion state.
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
 from public.reception_queue_facts(p_tenant) q join public.reception_sessions s on s.tenant_id=p_tenant and s.id=q.session_id
 where s.bag_id=p_bag and q.stage not in ('accepted','declined');
 return jsonb_build_object('accepted',accepted,'drafts',drafts,'receptions',receptions,'nextDraft',next_draft,'nextReception',next_reception);
end $$;
revoke all on function public.bag_work_summary(uuid,uuid) from public,anon;
grant execute on function public.bag_work_summary(uuid,uuid) to authenticated;
