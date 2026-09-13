-- P2 S19: printers and print jobs. The application renders a label (ZPL) from
-- a versioned template and queues it for a printer; a local agent, signed in
-- as a store member, claims the next job for its printer and reports the
-- outcome. Bulk reprint is many jobs. Rendering never happens in SQL.
create table public.printers (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 name text not null check(length(trim(name)) between 1 and 80),
 transport text not null check(transport in ('tcp','usb')),
 address text not null default '' check(length(address)<=200),
 model text not null default '' check(length(model)<=80),
 dpi integer not null default 203 check(dpi in (203,300,600)),
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,name)
);
create table public.print_jobs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 printer_id uuid not null,
 label_kind text not null check(label_kind in ('bag','garment','item','onboarding','markdown')),
 template_version text not null check(length(template_version) between 1 and 40),
 reference_kind text not null check(reference_kind in ('bag_receipt','garment_receipt','item','seller')),
 reference_id uuid not null,
 payload text not null check(length(payload) between 1 and 20000),
 copies integer not null default 1 check(copies between 1 and 20),
 status text not null default 'queued' check(status in ('queued','claimed','printed','failed','cancelled')),
 error text not null default '' check(length(error)<=500),
 requested_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 claimed_by uuid references auth.users(id),
 claimed_at timestamptz,
 completed_at timestamptz,
 unique(tenant_id,id),
 foreign key(tenant_id,printer_id) references public.printers(tenant_id,id),
 check((status in ('claimed','printed','failed'))=(claimed_at is not null)),
 check((status in ('printed','failed','cancelled'))=(completed_at is not null))
);
create index print_jobs_queue on public.print_jobs(tenant_id,printer_id,status,created_at,id);
alter table public.printers enable row level security;
alter table public.print_jobs enable row level security;
create policy printers_read on public.printers for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy print_jobs_read on public.print_jobs for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.printers,public.print_jobs from public,anon,authenticated;
grant select on public.printers,public.print_jobs to authenticated;
-- Jobs move only through the claim and complete functions; printers only through register.
create function komisio_private.guard_print_job() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.print_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.printer_id<>old.printer_id or new.payload<>old.payload or new.reference_id<>old.reference_id or new.requested_by<>old.requested_by then raise exception 'IMMUTABLE_PRINT_JOB' using errcode='55000'; end if;
 return new;
end $$;
create function komisio_private.guard_printer() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.print_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PRINTER' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.created_by<>old.created_by then raise exception 'IMMUTABLE_PRINTER' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_print_job(),komisio_private.guard_printer() from public,anon,authenticated;
create trigger print_jobs_guard before update or delete on public.print_jobs for each row execute function komisio_private.guard_print_job();
create trigger printers_guard before update or delete on public.printers for each row execute function komisio_private.guard_printer();

create function public.register_printer(p_tenant uuid,p_id uuid,p_name text,p_transport text,p_address text,p_model text,p_dpi integer,p_active boolean default true) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.printers; n text:=trim(coalesce(p_name,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or length(n) not between 1 and 80 or p_transport not in ('tcp','usb') or length(coalesce(p_address,''))>200 or length(coalesce(p_model,''))>80 or p_dpi not in (203,300,600) then raise exception 'INVALID_INPUT'; end if;
 if p_transport='tcp' and coalesce(p_address,'') !~ '^[A-Za-z0-9.\-]+(:[0-9]{2,5})?$' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.printers where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant then raise exception 'REQUEST_CONFLICT'; end if;
  -- Re-registering updates the mutable description of the same device.
  perform set_config('komisio.print_transition','engine',true);
  update public.printers set name=n,transport=p_transport,address=coalesce(p_address,''),model=coalesce(p_model,''),dpi=p_dpi,active=coalesce(p_active,true) where id=p_id;
  perform set_config('komisio.print_transition','',true);
  return p_id;
 end if;
 insert into public.printers(id,tenant_id,name,transport,address,model,dpi,active,created_by) values(p_id,p_tenant,n,p_transport,coalesce(p_address,''),coalesce(p_model,''),p_dpi,coalesce(p_active,true),uid);
 perform komisio_private.record_access(p_tenant,'printer.registered',p_id,jsonb_build_object('name',n,'transport',p_transport));
 return p_id;
end $$;

create function public.queue_print_job(p_tenant uuid,p_id uuid,p_printer uuid,p_kind text,p_template_version text,p_reference_kind text,p_reference_id uuid,p_payload text,p_copies integer default 1) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.print_jobs; printer public.printers; ok boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_printer is null or p_kind not in ('bag','garment','item','onboarding','markdown') or p_template_version is null or length(p_template_version) not between 1 and 40
  or p_reference_kind not in ('bag_receipt','garment_receipt','item','seller') or p_reference_id is null or p_payload is null or length(p_payload) not between 1 and 20000
  or p_copies is null or p_copies not between 1 and 20 then raise exception 'INVALID_INPUT'; end if;
 select * into printer from public.printers where tenant_id=p_tenant and id=p_printer;
 if not found then raise exception 'PRINTER_NOT_FOUND'; end if;
 if not printer.active then raise exception 'PRINTER_INACTIVE'; end if;
 select * into prior from public.print_jobs where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.printer_id is distinct from p_printer or prior.reference_id is distinct from p_reference_id or prior.payload is distinct from p_payload or prior.requested_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 ok:=case p_reference_kind
  when 'bag_receipt' then exists(select 1 from public.bag_receipts b where b.tenant_id=p_tenant and b.id=p_reference_id)
  when 'garment_receipt' then exists(select 1 from public.garment_receipts g where g.tenant_id=p_tenant and g.id=p_reference_id)
  when 'item' then exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=p_reference_id)
  when 'seller' then exists(select 1 from public.sellers s where s.tenant_id=p_tenant and s.id=p_reference_id)
  end;
 if not ok then raise exception 'REFERENCE_NOT_FOUND'; end if;
 insert into public.print_jobs(id,tenant_id,printer_id,label_kind,template_version,reference_kind,reference_id,payload,copies,requested_by)
 values(p_id,p_tenant,p_printer,p_kind,p_template_version,p_reference_kind,p_reference_id,p_payload,p_copies,uid);
 perform komisio_private.record_access(p_tenant,'print.queued',p_id,jsonb_build_object('printer_id',p_printer,'kind',p_kind,'reference_kind',p_reference_kind));
 return p_id;
end $$;

-- The agent claims the oldest queued job for its printer; an unfinished claim older than ten minutes may be claimed again.
create function public.claim_print_job(p_tenant uuid,p_printer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.printers where tenant_id=p_tenant and id=p_printer) then raise exception 'PRINTER_NOT_FOUND'; end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and printer_id=p_printer
  and (status='queued' or (status='claimed' and claimed_at<now()-interval '10 minutes')) order by created_at,id limit 1;
 if not found then return null; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status='claimed',claimed_by=uid,claimed_at=now() where id=job.id;
 perform set_config('komisio.print_transition','',true);
 return jsonb_build_object('jobId',job.id,'kind',job.label_kind,'templateVersion',job.template_version,'payload',job.payload,'copies',job.copies,'createdAt',job.created_at);
end $$;

create function public.complete_print_job(p_tenant uuid,p_job uuid,p_ok boolean,p_error text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs; err text:=left(trim(coalesce(p_error,'')),500);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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

create function public.cancel_print_job(p_tenant uuid,p_job uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); job public.print_jobs;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into job from public.print_jobs where tenant_id=p_tenant and id=p_job;
 if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;
 if job.status='cancelled' then return p_job; end if;
 if job.status<>'queued' then raise exception 'PRINT_JOB_DECIDED'; end if;
 perform set_config('komisio.print_transition','engine',true);
 update public.print_jobs set status='cancelled',completed_at=now() where id=p_job;
 perform set_config('komisio.print_transition','',true);
 return p_job;
end $$;
revoke all on function public.register_printer(uuid,uuid,text,text,text,text,integer,boolean),public.queue_print_job(uuid,uuid,uuid,text,text,text,uuid,text,integer),
 public.claim_print_job(uuid,uuid),public.complete_print_job(uuid,uuid,boolean,text),public.cancel_print_job(uuid,uuid) from public,anon;
grant execute on function public.register_printer(uuid,uuid,text,text,text,text,integer,boolean),public.queue_print_job(uuid,uuid,uuid,text,text,text,uuid,text,integer),
 public.claim_print_job(uuid,uuid),public.complete_print_job(uuid,uuid,boolean,text),public.cancel_print_job(uuid,uuid) to authenticated;
