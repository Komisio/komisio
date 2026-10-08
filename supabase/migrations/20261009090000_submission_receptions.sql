-- A preparation link is not custody or commercial acceptance.
create table public.submission_receptions (
 tenant_id uuid not null references public.tenants(id),
 submission_id uuid primary key,
 session_id uuid not null unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,submission_id) references public.seller_submissions(tenant_id,id),
 foreign key(tenant_id,session_id) references public.reception_sessions(tenant_id,id)
);
alter table public.submission_receptions enable row level security;
create policy submission_receptions_read on public.submission_receptions for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.submission_receptions from public,anon,authenticated;
grant select on public.submission_receptions to authenticated;
create trigger submission_receptions_plan before insert on public.submission_receptions for each row execute function komisio_private.plan_gate();
create trigger submission_receptions_immutable before update or delete on public.submission_receptions for each row execute function komisio_private.preserve_operation();

create function public.prepare_submission_reception(p_tenant uuid,p_submission uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); proposal public.seller_submissions; sid uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into proposal from public.seller_submissions where tenant_id=p_tenant and id=p_submission;
 if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if not exists(select 1 from public.seller_submission_reviews where tenant_id=p_tenant and submission_id=p_submission and decision='invite') then raise exception 'SUBMISSION_NOT_INVITED'; end if;
 select session_id into sid from public.submission_receptions where tenant_id=p_tenant and submission_id=p_submission;
 if found then return sid; end if;
 perform komisio_private.require_writable(p_tenant);
 sid:=gen_random_uuid();
 perform public.create_reception_session(p_tenant,sid,proposal.seller_id);
 insert into public.submission_receptions values(p_tenant,p_submission,sid,uid,now());
 perform komisio_private.record_access(p_tenant,'submission.reception_prepared',p_submission,jsonb_build_object('session_id',sid));
 return sid;
end $$;

create function public.complete_submission_reception(p_tenant uuid,p_submission uuid,p_description text,p_price text) returns uuid
language plpgsql security definer set search_path='' as $$
declare sid uuid; proposal public.seller_submissions; sources jsonb:='[]'; path text; photo uuid; target text; amount numeric;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select session_id into sid from public.submission_receptions where tenant_id=p_tenant and submission_id=p_submission;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 -- Another worker or a lost response may already have initialized this draft.
 -- Never overwrite subsequent staff work or repeat physical acceptance.
 if exists(select 1 from public.reception_source_revisions where tenant_id=p_tenant and session_id=sid) then return sid; end if;
 select * into proposal from public.seller_submissions where tenant_id=p_tenant and id=p_submission;
 if p_description is null or length(trim(p_description)) not between 1 and 1000 or p_price is null or p_price !~ '^(0|[1-9][0-9]{0,6})\.[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
 amount:=p_price::numeric;
 if amount<=0 then raise exception 'INVALID_INPUT'; end if;
 if proposal.price_currency is not null and proposal.price_currency is distinct from komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 for path in select jsonb_array_elements_text(proposal.photos) loop
  photo:=split_part(split_part(path,'/',3),'.',1)::uuid;
  target:=p_tenant::text||'/'||sid::text||'/'||photo::text||'.jpg';
  if not exists(select 1 from storage.objects where bucket_id='reception-photos' and name=target)
   or not exists(select 1 from storage.objects where bucket_id='seller-reception-photos' and name=target) then raise exception 'PHOTO_NOT_FOUND'; end if;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',photo,'kind','photo','reference',target,'observation',''));
 end loop;
 sources:=sources||jsonb_build_array(
  jsonb_build_object('id',gen_random_uuid(),'kind','observation','reference','komisio:manual-description:v1','observation',trim(p_description)),
  jsonb_build_object('id',gen_random_uuid(),'kind','price-evidence','reference','komisio:manual-appraisal:v1','observation',jsonb_build_object('amount',amount::numeric(12,2)::text,'reference','Submission '||p_submission::text,'rationale','Staff confirmed the proposed reception price')::text));
 perform public.save_reception_sources(p_tenant,gen_random_uuid(),sid,0,sources);
 return sid;
end $$;
revoke all on function public.prepare_submission_reception(uuid,uuid),public.complete_submission_reception(uuid,uuid,text,text) from public,anon;
grant execute on function public.prepare_submission_reception(uuid,uuid),public.complete_submission_reception(uuid,uuid,text,text) to authenticated;
