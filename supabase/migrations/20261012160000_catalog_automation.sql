-- Extension configuration and execution evidence; no financial core tables.
alter table public.automation_grants drop constraint automation_grants_scope_check;
alter table public.automation_grants add constraint automation_grants_scope_check
 check(scope in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull','day_close','catalog_export'));

create table public.catalog_automation_revisions (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 provider text not null check(provider in ('paypal','shopify')),
 connection_ref text not null, previous_id uuid references public.catalog_automation_revisions(id),
 enabled boolean not null, grant_id uuid references public.automation_grants(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 seq bigint generated always as identity, check(not enabled or grant_id is not null), unique(tenant_id,id)
);
create index catalog_automation_latest on public.catalog_automation_revisions(tenant_id,provider,connection_ref,seq desc);
create table public.catalog_export_jobs (
 id uuid primary key, tenant_id uuid not null, provider text not null,
 connection_ref text not null, item_id uuid not null, binding_id uuid not null,
 created_by uuid not null references auth.users(id),
 started_at timestamptz not null default clock_timestamp(),
 lease_until timestamptz not null default clock_timestamp()+interval '10 minutes',
 unique(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,binding_id) references public.catalog_automation_revisions(tenant_id,id)
);
create index catalog_export_job_latest on public.catalog_export_jobs(tenant_id,provider,item_id,started_at desc);
create table public.catalog_export_outcomes (
 job_id uuid primary key, tenant_id uuid not null,
 outcome text not null check(outcome in ('complete','held','failed')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,job_id) references public.catalog_export_jobs(tenant_id,id)
);
do $$ declare t text; begin
 foreach t in array array['catalog_automation_revisions','catalog_export_jobs','catalog_export_outcomes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy catalog_read on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
  execute format('create trigger catalog_immutable before update or delete on public.%I for each row execute function komisio_private.preserve_correction()',t);
 end loop;
end $$;

create function komisio_private.catalog_binding(p_tenant uuid,p_provider text) returns public.catalog_automation_revisions
language sql stable security definer set search_path='' as $$
 select r from public.catalog_automation_revisions r where r.tenant_id=p_tenant and r.provider=p_provider
 and r.connection_ref=komisio_private.sync_connection_ref(p_tenant,p_provider) order by r.seq desc limit 1;
$$;
create function komisio_private.catalog_allowed(p_tenant uuid,p_provider text,p_item uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(komisio_private.automation_allowed(p_tenant,'catalog_export'),false) and exists(
  select 1 from komisio_private.catalog_binding(p_tenant,p_provider) b
  join public.automation_grants g on g.id=b.grant_id and g.disabled_at is null and g.accepted_by=auth.uid()
  join public.catalog_export_jobs j on j.tenant_id=b.tenant_id and j.binding_id=b.id and j.provider=b.provider and j.connection_ref=b.connection_ref
  where b.enabled and j.created_by=auth.uid() and j.lease_until>clock_timestamp()
  and (p_item is null or j.item_id=p_item)
  and not exists(select 1 from public.catalog_export_outcomes o where o.job_id=j.id));
$$;
revoke all on function komisio_private.catalog_binding(uuid,text),komisio_private.catalog_allowed(uuid,text,uuid) from public,anon,authenticated;

create function public.catalog_automation_status(p_tenant uuid,p_provider text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.catalog_automation_revisions; job public.catalog_export_jobs; outcome text; connection text;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_provider is distinct from 'paypal' then return null;end if;
 connection:=komisio_private.sync_connection_ref(p_tenant,p_provider);
 if connection is null then return null;end if;
 b:=komisio_private.catalog_binding(p_tenant,p_provider);
 select * into job from public.catalog_export_jobs where tenant_id=p_tenant and provider=p_provider and connection_ref=connection order by started_at desc,id desc limit 1;
 select o.outcome into outcome from public.catalog_export_outcomes o where o.job_id=job.id;
 return jsonb_build_object('provider',p_provider,'connectionId',connection,'revision',b.id,
  'enabled',coalesce(b.enabled,false) and exists(select 1 from public.automation_grants where id=b.grant_id and disabled_at is null),
  'lastAt',job.started_at,'lastOutcome',case when job.id is null then null when outcome is not null then outcome when job.lease_until>clock_timestamp() then 'running' else 'held' end);
end $$;

create function public.save_catalog_automation(p_tenant uuid,p_id uuid,p_provider text,p_connection text,p_previous uuid,p_enabled boolean,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); b public.catalog_automation_revisions; prior public.catalog_automation_revisions; grant_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_provider is distinct from 'paypal' or p_enabled is null or p_connection is null then raise exception 'INVALID_INPUT';end if;
 if p_connection is distinct from komisio_private.sync_connection_ref(p_tenant,p_provider) then raise exception 'SYNC_CONNECTION_CHANGED';end if;
 select * into prior from public.catalog_automation_revisions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.provider is distinct from p_provider or prior.connection_ref is distinct from p_connection or prior.previous_id is distinct from p_previous or prior.enabled is distinct from p_enabled or prior.created_by is distinct from actor then raise exception 'REQUEST_CONFLICT';end if;
  return public.catalog_automation_status(p_tenant,p_provider);
 end if;
 b:=komisio_private.catalog_binding(p_tenant,p_provider);
 if b.id is distinct from p_previous then raise exception 'SYNC_SETTINGS_CHANGED';end if;
 if p_enabled then
  select id into grant_id from public.automation_grants where tenant_id=p_tenant and scope='catalog_export' and disabled_at is null;
  if grant_id is null then grant_id:=gen_random_uuid();perform public.enable_automation(p_tenant,grant_id,'catalog_export',p_identity_email);end if;
 end if;
 insert into public.catalog_automation_revisions(id,tenant_id,provider,connection_ref,previous_id,enabled,grant_id,created_by)
 values(p_id,p_tenant,p_provider,p_connection,p_previous,p_enabled,grant_id,actor);
 if not p_enabled then perform public.disable_automation(p_tenant,'catalog_export');end if;
 perform komisio_private.record_access(p_tenant,'integration.catalog_automation_saved',p_id,jsonb_build_object('provider',p_provider,'enabled',p_enabled));
 return public.catalog_automation_status(p_tenant,p_provider);
end $$;

-- Grants alone convey no catalog-write capability: a current, account-bound lease is required.
create index access_events_catalog_scans on public.access_events(tenant_id,id desc) where action='integration.catalog_scanned';
create function public.catalog_automation_connections() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return coalesce((select jsonb_agg(jsonb_build_object('tenantId',q.tenant_id,'provider',q.provider)) from (
  select g.tenant_id,b.provider from public.automation_grants g
  cross join lateral komisio_private.catalog_binding(g.tenant_id,'paypal') b
  where g.scope='catalog_export' and g.accepted_by=auth.uid() and g.disabled_at is null and b.enabled and b.grant_id=g.id
  and coalesce(komisio_private.automation_allowed(g.tenant_id,'catalog_export'),false)
  order by (select max(e.id) from public.access_events e where e.tenant_id=g.tenant_id and e.action='integration.catalog_scanned') asc nulls first,g.tenant_id limit 20
 ) q),'[]'::jsonb);
end $$;
create function public.claim_catalog_export(p_tenant uuid,p_id uuid,p_provider text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); b public.catalog_automation_revisions; job public.catalog_export_jobs; item uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 b:=komisio_private.catalog_binding(p_tenant,p_provider);
 if not coalesce(komisio_private.automation_allowed(p_tenant,'catalog_export'),false) or not coalesce(b.enabled,false)
  or not exists(select 1 from public.automation_grants g where g.id=b.grant_id and g.accepted_by=actor and g.disabled_at is null) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_provider is distinct from 'paypal' then raise exception 'INVALID_INPUT';end if;
 perform komisio_private.record_access(p_tenant,'integration.catalog_scanned',p_id,jsonb_build_object('provider',p_provider));
 select * into job from public.catalog_export_jobs where id=p_id;
 if found then
  if job.tenant_id is distinct from p_tenant or job.provider is distinct from p_provider or job.created_by is distinct from actor or job.binding_id is distinct from b.id then raise exception 'REQUEST_CONFLICT';end if;
  -- An unanswered claim never grants a second worker permission to execute it.
  return null;
 end if;
 if exists(select 1 from public.catalog_export_jobs j where j.tenant_id=p_tenant and j.provider=p_provider
  and j.lease_until>clock_timestamp() and not exists(select 1 from public.catalog_export_outcomes o where o.job_id=j.id)) then return null;end if;
 select i.id into item from public.items i
 cross join lateral (select s from jsonb_array_elements(komisio_private.item_sync_snapshot(p_tenant,i.id)) s where s->>'provider'=p_provider) state
 left join lateral (select j.started_at,o.outcome from public.catalog_export_jobs j left join public.catalog_export_outcomes o on o.job_id=j.id where j.tenant_id=p_tenant and j.provider=p_provider and j.item_id=i.id order by j.started_at desc,j.id desc limit 1) last on true
 where i.tenant_id=p_tenant and (state.s->>'canExport')::boolean and state.s->>'status' in ('not_sent','changed','failed','attention')
  and (last.started_at is null or last.started_at<clock_timestamp()-case when last.outcome='complete' then interval '5 minutes' else interval '1 hour' end)
 order by last.started_at asc nulls first,i.accepted_at,i.id limit 1;
 if item is null then return null;end if;
 insert into public.catalog_export_jobs(id,tenant_id,provider,connection_ref,item_id,binding_id,created_by)
 values(p_id,p_tenant,p_provider,b.connection_ref,item,b.id,actor) returning * into job;
 return jsonb_build_object('id',job.id,'itemId',job.item_id,'provider',job.provider,'connectionId',job.connection_ref);
end $$;
create function public.finish_catalog_export(p_tenant uuid,p_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); job public.catalog_export_jobs; prior public.catalog_export_outcomes;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into job from public.catalog_export_jobs where tenant_id=p_tenant and id=p_id;
 if job.id is null or job.created_by is distinct from actor or not coalesce(komisio_private.automation_allowed(p_tenant,'catalog_export'),false) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('complete','held','failed') then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.catalog_export_outcomes where job_id=p_id;
 if found then
  if prior.outcome is distinct from p_outcome then raise exception 'REQUEST_CONFLICT';end if;
  return;
 end if;
 if job.lease_until<=clock_timestamp() or job.binding_id is distinct from (komisio_private.catalog_binding(p_tenant,job.provider)).id or not komisio_private.catalog_allowed(p_tenant,job.provider,job.item_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 insert into public.catalog_export_outcomes(job_id,tenant_id,outcome,created_by) values(p_id,p_tenant,p_outcome,actor);
end $$;

create function public.catalog_export_item_access(p_tenant uuid,p_item uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_item is not null and komisio_private.catalog_allowed(p_tenant,'paypal',p_item);
$$;
create function public.catalog_export_payload(p_tenant uuid,p_export uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.zettle_product_exports;
begin
 select * into e from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if e.id is null or not komisio_private.catalog_allowed(p_tenant,'paypal',e.item_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('payload',e.payload,'previous_payload',e.previous_payload);
end $$;
create function public.catalog_export_connection(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_item is null or not komisio_private.catalog_allowed(p_tenant,'paypal',p_item) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('merchant_id',komisio_private.sync_connection_ref(p_tenant,'paypal'));
end $$;
revoke all on function public.catalog_automation_status(uuid,text),public.save_catalog_automation(uuid,uuid,text,text,uuid,boolean,text),public.catalog_automation_connections(),public.claim_catalog_export(uuid,uuid,text),public.finish_catalog_export(uuid,uuid,text),public.catalog_export_item_access(uuid,uuid),public.catalog_export_payload(uuid,uuid),public.catalog_export_connection(uuid,uuid) from public,anon;
grant execute on function public.catalog_automation_status(uuid,text),public.save_catalog_automation(uuid,uuid,text,text,uuid,boolean,text),public.catalog_automation_connections(),public.claim_catalog_export(uuid,uuid,text),public.finish_catalog_export(uuid,uuid,text),public.catalog_export_item_access(uuid,uuid),public.catalog_export_payload(uuid,uuid),public.catalog_export_connection(uuid,uuid) to authenticated;
