-- The handover summary and the registered-item list both filtered the view
-- inspection_current (distinct on draft_id over every store) by tenant and
-- bag after it was built, so each page render sorted the whole revisions
-- table. A draft's bag never changes (save_inspection_draft refuses another
-- bag), so bag membership is "any revision of the draft in this bag", and the
-- newest revision of the bag's own drafts is a DISTINCT ON over the bag's rows.
-- Both reads now use the index inspection_bag(tenant_id,bag_id,draft_id,
-- revision desc). Role, tenant, MFA and origin contracts, ordering, paging,
-- grants and every returned value are unchanged; only three expressions
-- inside the two bodies differ from the previous definitions.
create or replace function public.bag_work_summary(p_tenant uuid,p_bag uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare accepted integer; drafts integer; receptions integer; next_draft uuid; next_reception uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant and (
  (i.origin_kind='inspection_draft' and exists(select 1 from public.inspection_draft_revisions r where r.tenant_id=p_tenant and r.bag_id=p_bag and r.draft_id=i.origin_id))
  or (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.bag_id=p_bag and s.id=i.origin_id))
 );
 select count(*)::int,(array_agg(d.draft_id order by d.saved_at,d.draft_id))[1] into drafts,next_draft
 from (select distinct on (r.draft_id) r.draft_id,r.archived,r.saved_at from public.inspection_draft_revisions r where r.tenant_id=p_tenant and r.bag_id=p_bag order by r.draft_id,r.revision desc) d
 where not d.archived
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id);
 select count(*)::int,(array_agg(q.session_id order by q.created_at,q.session_id))[1] into receptions,next_reception
 from public.reception_queue_facts(p_tenant,null,null,null,null,p_bag) q
 where q.stage not in ('accepted','declined')
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='reception_review' and i.origin_id=q.session_id);
 return jsonb_build_object('accepted',accepted,'drafts',drafts,'receptions',receptions,'nextDraft',next_draft,'nextReception',next_reception);
end $$;
revoke all on function public.bag_work_summary(uuid,uuid) from public,anon;
grant execute on function public.bag_work_summary(uuid,uuid) to authenticated;

create or replace function public.bag_registered_items_page(p_tenant uuid,p_bag uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare skip integer:=coalesce(p_offset,0); rows jsonb; total integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 with scan as (
  select i.id,s.id as session_id,i.accepted_at
  from public.reception_sessions s join public.items i on i.tenant_id=s.tenant_id and i.origin_kind='reception_review' and i.origin_id=s.id
  where s.tenant_id=p_tenant and s.bag_id=p_bag
  union all
  select i.id,null::uuid as session_id,i.accepted_at
  from public.items i
  where i.tenant_id=p_tenant and i.origin_kind='inspection_draft'
  and exists(select 1 from public.inspection_draft_revisions r where r.tenant_id=p_tenant and r.bag_id=p_bag and r.draft_id=i.origin_id)
 ), page as (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select count(*)::int,coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'session_id',p.session_id,'title',komisio_private.item_title(p_tenant,p.id)->>'title',
  'price_ore',(select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=p.id order by seq desc limit 1),
  'photo_id',(select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=p.session_id and e->>'kind'='photo' order by r.revision desc,e->>'id' limit 1)
 ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb) into total,rows from scan;
 return jsonb_build_object('items',rows,'total',total,'offset',skip);
end $$;
revoke all on function public.bag_registered_items_page(uuid,uuid,integer) from public,anon;
grant execute on function public.bag_registered_items_page(uuid,uuid,integer) to authenticated;
