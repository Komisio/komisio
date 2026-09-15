-- Print devices (owner decision 2026-09-15: a store pairs the computer at
-- the printer with a code, nothing else). The device signs in anonymously,
-- exchanges the code for a membership with the role `device`, bound to one
-- printer, that can only claim and complete that printer's jobs and report
-- its own status. Devices see no store data: they are excluded from the
-- member tenant list, so every row-level policy denies them, and they read
-- their printer through one function. An owner or admin revokes a device at
-- any time; the anonymous user then has nothing.
alter table public.tenant_members drop constraint tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check check(role in ('owner','admin','staff','readonly','automation','device'));

create table public.print_devices (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 printer_id uuid not null,
 user_id uuid not null unique references auth.users(id),
 name text not null check(length(name) between 1 and 80),
 version text not null default '' check(length(version)<=40),
 paired_by uuid not null references auth.users(id),
 paired_at timestamptz not null default now(),
 last_seen_at timestamptz,
 printer_reachable boolean,
 last_error text not null default '' check(length(last_error)<=500),
 revoked_by uuid references auth.users(id),
 revoked_at timestamptz,
 unique(tenant_id,id),
 foreign key(tenant_id,printer_id) references public.printers(tenant_id,id)
);
create table public.print_pairing_codes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 printer_id uuid not null,
 code_hash text not null unique,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz,
 device_id uuid,
 foreign key(tenant_id,printer_id) references public.printers(tenant_id,id)
);
create index print_devices_store on public.print_devices(tenant_id,printer_id,paired_at desc);
alter table public.print_devices enable row level security;
alter table public.print_pairing_codes enable row level security;
revoke all on public.print_devices,public.print_pairing_codes from public,anon,authenticated;
grant select on public.print_devices to authenticated;
create policy read_store on public.print_devices for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.print_devices as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
-- Codes are hashes and never readable; the pairing function is the only reader.
create policy no_reads on public.print_pairing_codes for select to authenticated using(false);

-- Devices are never in the member tenant list: no policy admits them.
create or replace function public.user_tenant_ids() returns setof uuid
language sql stable security definer set search_path='' as $$
 select tenant_id from public.tenant_members where user_id=auth.uid() and role<>'device' and public.verified_session();
$$;

-- A paired, unrevoked device counts as a verified session although it has no e-mail.
create or replace function public.verified_session() returns boolean
language sql stable security definer set search_path='' as $$
 select (exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
   or exists(select 1 from public.print_devices d where d.user_id=auth.uid() and d.revoked_at is null))
 and (not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
      or coalesce(auth.jwt()->>'aal','')='aal2');
$$;

-- Technical memberships (automation, device) change only through their functions.
create or replace function komisio_private.guard_automation_member() returns trigger
language plpgsql set search_path='' as $$
begin
 if (tg_op<>'INSERT' and old.role in ('automation','device')) or (tg_op<>'DELETE' and new.role in ('automation','device')) then
  if current_setting('komisio.automation_transition',true) is distinct from 'engine' then raise exception 'AUTOMATION_MEMBERSHIP' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.role<>new.role then raise exception 'AUTOMATION_MEMBERSHIP' using errcode='55000'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

-- The device row of the caller for one printer, or null.
create function komisio_private.print_device_for(p_tenant uuid,p_printer uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select d.id from public.print_devices d where d.user_id=auth.uid() and d.tenant_id=p_tenant and d.printer_id=p_printer and d.revoked_at is null
  and exists(select 1 from public.tenant_members m where m.tenant_id=p_tenant and m.user_id=auth.uid() and m.role='device');
$$;
revoke all on function komisio_private.print_device_for(uuid,uuid) from public,anon,authenticated;

-- Owner or admin: a one-time code for one printer, valid fifteen minutes, shown once.
create function public.create_print_pairing_code(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); code text; expires timestamptz:=now()+interval '15 minutes';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer and transport='tcp') then raise exception 'PRINTER_NOT_FOUND'; end if;
 code:=upper(left(replace(gen_random_uuid()::text,'-',''),10));
 insert into public.print_pairing_codes(tenant_id,printer_id,code_hash,created_by,expires_at) values(p_tenant,p_printer,encode(sha256(convert_to(code,'UTF8')),'hex'),uid,expires);
 perform komisio_private.record_access(p_tenant,'print.pairing_code_created',p_printer,jsonb_build_object('expires_at',expires));
 return jsonb_build_object('code',left(code,5)||'-'||right(code,5),'expiresAt',expires);
end $$;

-- The device (an anonymous user) exchanges the code for its membership. Not a member function: the device has nothing yet.
create function public.pair_print_device(p_code text,p_name text,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); code text:=upper(replace(trim(coalesce(p_code,'')),'-','')); pc public.print_pairing_codes; pr public.printers; device public.print_devices; n text:=left(trim(coalesce(p_name,'')),80);
begin
 if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'true' then raise exception 'PAIRING_REQUIRES_DEVICE' using errcode='42501'; end if;
 if exists(select 1 from public.print_devices where user_id=uid) then raise exception 'DEVICE_ALREADY_PAIRED'; end if;
 if code !~ '^[0-9A-F]{10}$' or n='' then raise exception 'PAIRING_CODE_INVALID'; end if;
 select * into pc from public.print_pairing_codes where code_hash=encode(sha256(convert_to(code,'UTF8')),'hex') for update;
 if not found or pc.used_at is not null or pc.expires_at<=now() then raise exception 'PAIRING_CODE_INVALID'; end if;
 perform 1 from public.tenants where id=pc.tenant_id for update;
 select * into pr from public.printers where tenant_id=pc.tenant_id and id=pc.printer_id;
 if not found then raise exception 'PRINTER_NOT_FOUND'; end if;
 perform set_config('komisio.automation_transition','engine',true);
 insert into public.tenant_members(tenant_id,user_id,role) values(pc.tenant_id,uid,'device');
 perform set_config('komisio.automation_transition','',true);
 insert into public.print_devices(tenant_id,printer_id,user_id,name,version,paired_by) values(pc.tenant_id,pc.printer_id,uid,n,left(coalesce(p_version,''),40),pc.created_by) returning * into device;
 update public.print_pairing_codes set used_at=now(),device_id=device.id where id=pc.id;
 perform komisio_private.record_access(pc.tenant_id,'print.device_paired',device.id,jsonb_build_object('printer_id',pc.printer_id,'name',n));
 return jsonb_build_object('deviceId',device.id,'tenantId',pc.tenant_id,'printerId',pc.printer_id,'printerName',pr.name,'address',pr.address);
end $$;

-- What the device may know: its printer. Revoked devices get nothing.
create function public.print_device_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); device public.print_devices; pr public.printers;
begin
 select * into device from public.print_devices where user_id=uid and revoked_at is null;
 if not found then raise exception 'DEVICE_REVOKED' using errcode='42501'; end if;
 select * into pr from public.printers where tenant_id=device.tenant_id and id=device.printer_id;
 return jsonb_build_object('deviceId',device.id,'tenantId',device.tenant_id,'printerId',device.printer_id,'printerName',pr.name,'address',pr.address,'transport',pr.transport,'active',pr.active);
end $$;

-- The device's heartbeat: version, whether the printer answered, the last error.
create function public.report_print_device(p_status jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); device public.print_devices;
begin
 select * into device from public.print_devices where user_id=uid and revoked_at is null for update;
 if not found then raise exception 'DEVICE_REVOKED' using errcode='42501'; end if;
 if p_status is null or jsonb_typeof(p_status)<>'object' then raise exception 'INVALID_INPUT'; end if;
 update public.print_devices set last_seen_at=now(),
  version=left(coalesce(p_status->>'version',version),40),
  printer_reachable=case when jsonb_typeof(p_status->'printerReachable')='boolean' then (p_status->>'printerReachable')::boolean else printer_reachable end,
  last_error=left(coalesce(p_status->>'error',''),500)
  where id=device.id;
end $$;

create function public.revoke_print_device(p_tenant uuid,p_device uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); device public.print_devices;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into device from public.print_devices where tenant_id=p_tenant and id=p_device;
 if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
 if device.revoked_at is not null then return false; end if;
 update public.print_devices set revoked_by=uid,revoked_at=now() where id=device.id;
 perform set_config('komisio.automation_transition','engine',true);
 delete from public.tenant_members where tenant_id=p_tenant and user_id=device.user_id and role='device';
 perform set_config('komisio.automation_transition','',true);
 perform komisio_private.record_access(p_tenant,'print.device_revoked',device.id,jsonb_build_object('printer_id',device.printer_id));
 return true;
end $$;

-- The store's devices; any member.
create function public.print_devices(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'printerId',d.printer_id,'name',d.name,'version',d.version,'pairedAt',d.paired_at,'lastSeenAt',d.last_seen_at,'printerReachable',d.printer_reachable,'lastError',d.last_error,'revokedAt',d.revoked_at) order by d.paired_at desc)
  from public.print_devices d where d.tenant_id=p_tenant),'[]'::jsonb);
end $$;

create or replace function public.claim_print_job(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or komisio_private.print_device_for(p_tenant,p_printer) is not null) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer) then raise exception 'PRINTER_NOT_FOUND'; end if;
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
revoke all on function public.create_print_pairing_code(uuid,uuid),public.pair_print_device(text,text,text),public.print_device_context(),public.report_print_device(jsonb),public.revoke_print_device(uuid,uuid),public.print_devices(uuid) from public,anon;
grant execute on function public.create_print_pairing_code(uuid,uuid),public.pair_print_device(text,text,text),public.print_device_context(),public.report_print_device(jsonb),public.revoke_print_device(uuid,uuid),public.print_devices(uuid) to authenticated;
