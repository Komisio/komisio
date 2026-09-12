create table public.reception_assistance_attempts(
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 session_id uuid not null,
 source_revision integer not null,
 created_by uuid not null references auth.users(id),
 model text not null check(length(model) between 1 and 100),
 prompt_version text not null check(length(prompt_version) between 1 and 100),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,session_id) references public.reception_sessions(tenant_id,id),
 foreign key(session_id,source_revision) references public.reception_source_revisions(session_id,revision)
);
create index reception_assistance_budget on public.reception_assistance_attempts(tenant_id,created_at desc);
alter table public.reception_assistance_attempts enable row level security;
revoke all on public.reception_assistance_attempts from anon,authenticated;
grant select on public.reception_assistance_attempts to authenticated;
create policy reception_assistance_read on public.reception_assistance_attempts for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff'));
create policy reception_assistance_boundary on public.reception_assistance_attempts as restrictive for all to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff')) with check(false);

create function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_revision is null or p_revision<1
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or p_prompt is distinct from 'reception-v1' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_assistance_attempts where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.source_revision is distinct from p_revision
   or prior.created_by is distinct from uid or prior.model is distinct from p_model or prior.prompt_version is distinct from p_prompt then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 select revision into latest from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if latest is distinct from p_revision then raise exception 'RECEPTION_CHANGED'; end if;
 moment:=clock_timestamp();
 if exists(select 1 from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '20 seconds')
  or (select count(*) from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
 values(p_request,p_tenant,p_session,p_revision,uid,p_model,p_prompt,moment);
 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));
 return true;
end $$;
revoke all on function public.reserve_reception_assistance(uuid,uuid,uuid,integer,text,text) from public;
grant execute on function public.reserve_reception_assistance(uuid,uuid,uuid,integer,text,text) to authenticated;
