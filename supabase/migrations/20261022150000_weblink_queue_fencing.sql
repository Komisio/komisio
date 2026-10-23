-- #542, owner-approved 2026-10-22. No existing printer is converted or activated.
-- Weblink onboarding/UI and the hosted transport remain separate release gates.
alter table public.printers drop constraint printers_transport_check;
alter table public.printers add constraint printers_transport_check check(transport in ('tcp','usb','weblink'));
alter table public.print_jobs
 add column dispatch_attempt uuid,
 add column dispatch_device_id uuid,
 add column dispatch_resolution_note text,
 add column dispatch_resolved_by uuid references auth.users(id),
 add column dispatch_resolved_at timestamptz,
 add constraint print_dispatch_device_fk foreign key(tenant_id,dispatch_device_id) references public.print_devices(tenant_id,id);
create unique index print_dispatch_attempt on public.print_jobs(dispatch_attempt) where dispatch_attempt is not null;
alter table public.print_jobs drop constraint print_jobs_status_check;
alter table public.print_jobs drop constraint print_jobs_check;
alter table public.print_jobs drop constraint print_jobs_check1;
alter table public.print_jobs
 add constraint print_jobs_status_check check(status in ('queued','claimed','printed','failed','cancelled','dispatching','transport_accepted','outcome_unknown')),
 add constraint print_jobs_claim_check check((status in ('claimed','printed','failed','dispatching','transport_accepted','outcome_unknown') or (status='cancelled' and dispatch_attempt is not null))=(claimed_at is not null)),
 add constraint print_jobs_completed_check check((status in ('printed','failed','cancelled','transport_accepted','outcome_unknown'))=(completed_at is not null)),
 add constraint print_dispatch_identity_check check((dispatch_attempt is null)=(dispatch_device_id is null)),
 add constraint print_dispatch_state_check check(
  (dispatch_attempt is null and status not in ('dispatching','transport_accepted','outcome_unknown')) or
  (dispatch_attempt is not null and claimed_by is not null and status in ('dispatching','transport_accepted','outcome_unknown','printed','cancelled'))),
 add constraint print_dispatch_resolution_check check(
  (dispatch_resolution_note is null and dispatch_resolved_by is null and dispatch_resolved_at is null and not(dispatch_attempt is not null and status in ('printed','cancelled'))) or
  (dispatch_attempt is not null and status in ('printed','cancelled') and dispatch_resolution_note is not null and length(trim(dispatch_resolution_note)) between 1 and 500 and dispatch_resolved_by is not null and dispatch_resolved_at is not null));

create or replace function komisio_private.guard_printer() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.print_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PRINTER' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.created_by<>old.created_by then raise exception 'IMMUTABLE_PRINTER' using errcode='55000'; end if;
 if new.transport is distinct from old.transport and (new.transport='weblink' or old.transport='weblink') then raise exception 'PRINT_TRANSPORT_FIXED'; end if;
 return new;
end $$;

create or replace function komisio_private.guard_print_job() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.print_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 if row(new.id,new.tenant_id,new.printer_id,new.payload,new.reference_id,new.requested_by,new.copies,new.label_kind,new.template_version,new.reference_kind)
  is distinct from row(old.id,old.tenant_id,old.printer_id,old.payload,old.reference_id,old.requested_by,old.copies,old.label_kind,old.template_version,old.reference_kind)
 then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 if old.dispatch_attempt is not null then
  if row(new.dispatch_attempt,new.dispatch_device_id,new.claimed_by,new.claimed_at) is distinct from row(old.dispatch_attempt,old.dispatch_device_id,old.claimed_by,old.claimed_at)
   or old.status in ('printed','cancelled') or new.status not in ('transport_accepted','outcome_unknown','printed','cancelled')
   or (old.status<>'dispatching' and new.status not in ('printed','cancelled'))
  then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 elsif new.dispatch_attempt is not null then
  if old.status<>'queued' or new.status<>'dispatching' or not exists(select 1 from public.printers where tenant_id=new.tenant_id and id=new.printer_id and transport='weblink')
  then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 end if;
 return new;
end $$;

-- A permit is returned once, in the same transaction that permanently reserves
-- the job. Retrying an attempt only returns evidence, never its ZPL or a permit.
create function public.claim_weblink_print_job(p_tenant uuid,p_printer uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); device uuid; job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 device:=komisio_private.print_device_for(p_tenant,p_printer);
 if device is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_attempt is null then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport='weblink' and active) then raise exception 'PRINTER_INACTIVE'; end if;
 select * into job from public.print_jobs where dispatch_attempt=p_attempt;
 if found then
  if job.tenant_id<>p_tenant or job.printer_id<>p_printer or job.dispatch_device_id<>device or job.claimed_by<>uid then raise exception 'PRINT_ATTEMPT_CONFLICT'; end if;
  return jsonb_build_object('jobId',job.id,'attemptId',p_attempt,'state',job.status,'canSend',false);
 end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and printer_id=p_printer and status='queued' order by created_at,id limit 1;
 if not found then return null; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status='dispatching',claimed_by=uid,claimed_at=now(),dispatch_attempt=p_attempt,dispatch_device_id=device where id=job.id;
 perform set_config('komisio.print_transition','',true);
 perform komisio_private.record_access(p_tenant,'print.dispatch_reserved',job.id,jsonb_build_object('printer_id',p_printer,'device_id',device,'attempt_id',p_attempt));
 return jsonb_build_object('jobId',job.id,'attemptId',p_attempt,'state','dispatching','canSend',true,'payload',job.payload,'copies',job.copies);
end $$;

create function public.finish_weblink_print_job(p_tenant uuid,p_job uuid,p_attempt uuid,p_outcome text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); device uuid; job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into job from public.print_jobs where tenant_id=p_tenant and id=p_job;
 device:=komisio_private.print_device_for(p_tenant,job.printer_id);
 if device is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_outcome is null or p_outcome not in ('transport_accepted','outcome_unknown') or p_attempt is null then raise exception 'INVALID_INPUT'; end if;
 if job.dispatch_attempt is distinct from p_attempt or job.dispatch_device_id is distinct from device or job.claimed_by is distinct from uid then raise exception 'PRINT_ATTEMPT_CONFLICT'; end if;
 if job.status=p_outcome then return p_job; end if;
 if job.status<>'dispatching' then raise exception 'PRINT_JOB_DECIDED'; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status=p_outcome,completed_at=now() where id=p_job;
 perform set_config('komisio.print_transition','',true);
 perform komisio_private.record_access(p_tenant,'print.dispatch_finished',p_job,jsonb_build_object('attempt_id',p_attempt,'outcome',p_outcome));
 return p_job;
end $$;

-- Inspection does not retry a job. A replacement, if chosen, is a new queue row.
-- Revoke the old device first, stop its connection and inspect buffered output.
create function public.resolve_weblink_print_job(p_tenant uuid,p_job uuid,p_resolution text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs; note text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_resolution is null or p_resolution not in ('printed','cancelled') or length(note) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;
 if job.dispatch_attempt is null then raise exception 'PRINT_ATTEMPT_CONFLICT'; end if;
 if job.status in ('printed','cancelled') then
  if job.status=p_resolution and job.dispatch_resolution_note=note then return p_job; end if;
  raise exception 'PRINT_JOB_DECIDED';
 end if;
 if job.status not in ('dispatching','transport_accepted','outcome_unknown') then raise exception 'PRINT_JOB_DECIDED'; end if;
 if not exists(select 1 from public.print_devices where tenant_id=p_tenant and id=job.dispatch_device_id and revoked_at is not null) then raise exception 'PRINT_DEVICE_STILL_ACTIVE'; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status=p_resolution,completed_at=now(),dispatch_resolution_note=note,dispatch_resolved_by=uid,dispatch_resolved_at=now() where id=p_job;
 perform set_config('komisio.print_transition','',true);
 perform komisio_private.record_access(p_tenant,'print.dispatch_resolved',p_job,jsonb_build_object('attempt_id',job.dispatch_attempt,'resolution',p_resolution,'inspection',note));
 return p_job;
end $$;

revoke all on function public.claim_weblink_print_job(uuid,uuid,uuid),public.finish_weblink_print_job(uuid,uuid,uuid,text),public.resolve_weblink_print_job(uuid,uuid,text,text) from public,anon;
grant execute on function public.claim_weblink_print_job(uuid,uuid,uuid),public.finish_weblink_print_job(uuid,uuid,uuid,text),public.resolve_weblink_print_job(uuid,uuid,text,text) to authenticated;

-- Existing TCP/USB rules are preserved; Weblink cannot use legacy RPCs.
create or replace function public.claim_print_job(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or komisio_private.print_device_for(p_tenant,p_printer) is not null) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer) then raise exception 'PRINTER_NOT_FOUND'; end if;
 if exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport='weblink') then raise exception 'WEBLINK_REQUIRED'; end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and printer_id=p_printer
  and (status='queued' or (status='claimed' and claimed_at<now()-interval '10 minutes')) order by created_at,id limit 1;
 if not found then return null; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status='claimed',claimed_by=uid,claimed_at=now() where id=job.id;
 perform set_config('komisio.print_transition','',true);
 return jsonb_build_object('jobId',job.id,'kind',job.label_kind,'templateVersion',job.template_version,'payload',job.payload,'copies',job.copies,'createdAt',job.created_at);
end $$;

create or replace function public.complete_print_job(p_tenant uuid,p_job uuid,p_ok boolean,p_error text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs; err text:=left(trim(coalesce(p_error,'')),500);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into job from public.print_jobs where tenant_id=p_tenant and id=p_job;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or (job.id is not null and komisio_private.print_device_for(p_tenant,job.printer_id) is not null)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_job is null or p_ok is null then raise exception 'INVALID_INPUT'; end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;
 if job.dispatch_attempt is not null or exists(select 1 from public.printers where tenant_id=p_tenant and id=job.printer_id and transport='weblink') then raise exception 'WEBLINK_REQUIRED'; end if;
 if job.status in ('printed','failed','cancelled') then
  if job.status=(case when p_ok then 'printed' else 'failed' end) then return p_job; end if;
  raise exception 'PRINT_JOB_DECIDED';
 end if;
 if job.status<>'claimed' then raise exception 'PRINT_JOB_NOT_CLAIMED'; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status=case when p_ok then 'printed' else 'failed' end,error=case when p_ok then '' else err end,completed_at=now() where id=p_job;
 perform set_config('komisio.print_transition','',true);
 perform komisio_private.record_access(p_tenant,case when p_ok then 'print.printed' else 'print.failed' end,p_job,jsonb_build_object('printer_id',job.printer_id));
 return p_job;
end $$;

create or replace function public.create_print_pairing_code(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); code text; expires timestamptz:=now()+interval '15 minutes';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport in ('tcp','weblink')) then raise exception 'PRINTER_NOT_FOUND'; end if;
 code:=upper(left(replace(gen_random_uuid()::text,'-',''),10));
 insert into public.print_pairing_codes(tenant_id,printer_id,code_hash,created_by,expires_at) values(p_tenant,p_printer,encode(sha256(convert_to(code,'UTF8')),'hex'),uid,expires);
 perform komisio_private.record_access(p_tenant,'print.pairing_code_created',p_printer,jsonb_build_object('expires_at',expires));
 return jsonb_build_object('code',left(code,5)||'-'||right(code,5),'expiresAt',expires);
end $$;
