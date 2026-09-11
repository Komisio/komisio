-- Archive draft preparation only. Custody and commercial decisions are unchanged.
alter table public.inspection_draft_revisions
 add column archived boolean not null default false,
 add column change_reason text not null default '' check(length(change_reason)<=500),
 add constraint inspection_archive_reason check(not archived or length(trim(change_reason))>0);
create or replace view public.inspection_current with (security_invoker=true) as
 select distinct on (draft_id) * from public.inspection_draft_revisions order by draft_id,revision desc;
revoke all on public.inspection_current from public,anon,authenticated;
grant select on public.inspection_current to authenticated;

create or replace function public.save_inspection_draft(p_tenant uuid,p_request uuid,p_bag uuid,p_draft uuid,p_expected integer,p_description text,p_category text,p_condition text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.inspection_draft_revisions;
 latest public.inspection_draft_revisions; d text:=trim(p_description); c text:=trim(p_category); n text:=trim(p_condition);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_bag is null or p_draft is null or p_expected is null or p_expected<0 or p_expected>=2147483647
 or d is null or length(d) not between 1 and 1000 or c is null or length(c)>120 or n is null or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.inspection_draft_revisions where id=p_request;
 if found then
  if previous.archived or previous.change_reason<>'' or previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.bag_id is distinct from p_bag or previous.draft_id is distinct from p_draft or previous.revision is distinct from p_expected+1
  or previous.description is distinct from d or previous.category is distinct from c or previous.condition is distinct from n then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if not exists(select 1 from public.bag_receipts where id=p_bag and tenant_id=p_tenant) then raise exception 'BAG_NOT_FOUND'; end if;
 select * into latest from public.inspection_draft_revisions where draft_id=p_draft order by revision desc limit 1;
 if found and (latest.tenant_id is distinct from p_tenant or latest.bag_id is distinct from p_bag) then raise exception 'INSPECTION_CONTEXT_CHANGED'; end if;
 if coalesce(latest.revision,0)<>p_expected then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
 if latest.archived then raise exception 'INSPECTION_ARCHIVED'; end if;
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,created_by)
 values(p_request,p_tenant,p_bag,p_draft,p_expected+1,d,c,n,uid);
 perform komisio_private.record_access(p_tenant,'inspection.saved',p_draft,jsonb_build_object('revision',p_expected+1,'bag_id',p_bag));
 return p_request;
end $$;
revoke all on function public.save_inspection_draft(uuid,uuid,uuid,uuid,integer,text,text,text) from public,anon;
grant execute on function public.save_inspection_draft(uuid,uuid,uuid,uuid,integer,text,text,text) to authenticated;

create function public.set_inspection_archived(p_tenant uuid,p_request uuid,p_bag uuid,p_draft uuid,p_expected integer,p_archived boolean,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.inspection_draft_revisions;
 latest public.inspection_draft_revisions; r text:=trim(p_reason);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_bag is null or p_draft is null or p_expected is null or p_expected<1 or p_expected>=2147483647
 or p_archived is null or r is null or length(r) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.inspection_draft_revisions where id=p_request;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.bag_id is distinct from p_bag or previous.draft_id is distinct from p_draft or previous.revision is distinct from p_expected+1
  or previous.archived is distinct from p_archived or previous.change_reason is distinct from r then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 select * into latest from public.inspection_draft_revisions where draft_id=p_draft and tenant_id=p_tenant and bag_id=p_bag order by revision desc limit 1;
 if not found then raise exception 'INSPECTION_NOT_FOUND'; end if;
 if latest.revision<>p_expected then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
 if latest.archived=p_archived then raise exception 'INSPECTION_STATUS_UNCHANGED'; end if;
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,created_by,archived,change_reason)
 values(p_request,p_tenant,p_bag,p_draft,p_expected+1,latest.description,latest.category,latest.condition,uid,p_archived,r);
 perform komisio_private.record_access(p_tenant,case when p_archived then 'inspection.archived' else 'inspection.reopened' end,p_draft,jsonb_build_object('revision',p_expected+1,'bag_id',p_bag));
 return p_request;
end $$;
revoke all on function public.set_inspection_archived(uuid,uuid,uuid,uuid,integer,boolean,text) from public,anon;
grant execute on function public.set_inspection_archived(uuid,uuid,uuid,uuid,integer,boolean,text) to authenticated;
