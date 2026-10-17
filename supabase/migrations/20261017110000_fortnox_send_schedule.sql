-- Owner-approved per-store scheduling (#488). Configuration revisions retain
-- grant provenance; disabling/re-enabling never resets the store's chosen time.
create table public.fortnox_schedule_revisions (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 previous_id uuid, grant_id uuid references public.automation_grants(id),
 send_time time not null check(extract(second from send_time)=0 and send_time<'24:00'::time),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 seq bigint generated always as identity, unique(tenant_id,id),
 foreign key(tenant_id,previous_id) references public.fortnox_schedule_revisions(tenant_id,id)
);
create index fortnox_schedule_latest on public.fortnox_schedule_revisions(tenant_id,seq desc);
alter table public.fortnox_schedule_revisions enable row level security;
revoke all on public.fortnox_schedule_revisions from public,anon,authenticated;
grant select on public.fortnox_schedule_revisions to authenticated;
create policy fortnox_schedule_read on public.fortnox_schedule_revisions for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger fortnox_schedule_immutable before update or delete on public.fortnox_schedule_revisions
 for each row execute function komisio_private.preserve_correction();
create index fortnox_daily_runs on public.access_events(tenant_id,id desc)
 where action in ('fortnox.automatic_started','fortnox.automatic_run');
create index fortnox_claim_day on public.access_events(tenant_id,(detail->>'day'),id)
 where action='fortnox.automatic_started';
create index fortnox_run_request on public.access_events(target_id,tenant_id)
 where action in ('fortnox.automatic_started','fortnox.automatic_run');

create function public.fortnox_send_schedule(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.fortnox_schedule_revisions;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into r from public.fortnox_schedule_revisions where tenant_id=p_tenant order by seq desc limit 1;
 return jsonb_build_object('id',r.id,'time',left(coalesce(r.send_time,'07:00'::time)::text,5));
end $$;

create function public.save_fortnox_send_schedule(p_tenant uuid,p_id uuid,p_previous uuid,p_time text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.fortnox_schedule_revisions; latest uuid; grant_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.fortnox_schedule_revisions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from actor or prior.previous_id is distinct from p_previous or prior.send_time is distinct from p_time::time then raise exception 'REQUEST_CONFLICT';end if;
  return jsonb_build_object('id',prior.id,'time',left(prior.send_time::text,5));
 end if;
 select id into latest from public.fortnox_schedule_revisions where tenant_id=p_tenant order by seq desc limit 1;
 if latest is distinct from p_previous then raise exception 'FORTNOX_SCHEDULE_CHANGED';end if;
 select id into grant_id from public.automation_grants where tenant_id=p_tenant and scope='fortnox_send' and disabled_at is null;
 insert into public.fortnox_schedule_revisions(id,tenant_id,previous_id,grant_id,send_time,created_by)
 values(p_id,p_tenant,p_previous,grant_id,p_time::time,actor);
 perform komisio_private.record_access(p_tenant,'fortnox.schedule_changed',p_id,jsonb_build_object('time',p_time,'timezone','Europe/Stockholm'));
 return public.fortnox_send_schedule(p_tenant);
end $$;

-- First real minute at/after the requested Stockholm wall time. The bounded
-- search resolves both the spring gap and the first occurrence of a repeated
-- autumn time without depending on the database session timezone.
create function komisio_private.fortnox_scheduled_at(p_day date,p_time time) returns timestamptz
language sql stable set search_path='' as $$
 select min(moment) from generate_series(
  ((p_day+p_time) at time zone 'Europe/Stockholm')-interval '2 hours',
  (p_day+p_time) at time zone 'Europe/Stockholm',interval '1 minute') moment
 where moment at time zone 'Europe/Stockholm'>=p_day+p_time;
$$;

create function komisio_private.fortnox_daily_due(p_tenant uuid,p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date:=(p_now at time zone 'Europe/Stockholm')::date; first_run public.access_events;
 last_run public.access_events; schedule_time time; cutoff timestamptz;
begin
 select * into first_run from public.access_events where tenant_id=p_tenant and action='fortnox.automatic_started'
  and detail->>'day'=day::text order by id limit 1;
 if first_run.id is not null then
  cutoff:=(first_run.detail->>'cutoff')::timestamptz;
  select * into last_run from public.access_events where tenant_id=p_tenant and action='fortnox.automatic_started'
   and detail->>'day'=day::text order by id desc limit 1;
  if not exists(select 1 from public.access_events where tenant_id=p_tenant and action='fortnox.automatic_run'
   and target_id=last_run.target_id and detail->>'outcome'='partial') then return null;end if;
 else
  -- Existing completion evidence also counts on the migration day.
  select * into last_run from public.access_events where tenant_id=p_tenant and action='fortnox.automatic_run'
   and coalesce(detail->>'day',((occurred_at at time zone 'Europe/Stockholm')::date)::text)=day::text order by id desc limit 1;
  if last_run.id is not null and last_run.detail->>'outcome'<>'partial' then return null;end if;
  select send_time into schedule_time from public.fortnox_schedule_revisions where tenant_id=p_tenant order by seq desc limit 1;
  cutoff:=komisio_private.fortnox_scheduled_at(day,coalesce(schedule_time,'07:00'::time));
 end if;
 if p_now<cutoff then return null;end if;
 return jsonb_build_object('day',day,'cutoff',cutoff);
end $$;

create or replace function public.fortnox_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return (select coalesce(jsonb_agg(jsonb_build_object('tenantId',g.tenant_id) order by g.tenant_id),'[]') from public.automation_grants g
 where g.scope='fortnox_send' and g.disabled_at is null and g.accepted_by=auth.uid()
  and komisio_private.automation_allowed(g.tenant_id,'fortnox_send')
  and komisio_private.fortnox_daily_due(g.tenant_id,now()) is not null);
end $$;

create function public.begin_fortnox_automatic_run(p_tenant uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); due jsonb; prior public.access_events; grant_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'fortnox_send'),false) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.access_events where action='fortnox.automatic_started' and target_id=p_id limit 1;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.actor_id is distinct from actor then raise exception 'REQUEST_CONFLICT';end if;
  return false;
 end if;
 due:=komisio_private.fortnox_daily_due(p_tenant,clock_timestamp());
 if due is null then return false;end if;
 select id into grant_id from public.automation_grants where tenant_id=p_tenant and scope='fortnox_send' and disabled_at is null and accepted_by=actor;
 perform komisio_private.record_access(p_tenant,'fortnox.automatic_started',p_id,
  due||jsonb_build_object('grantId',grant_id,'leaseUntil',least(clock_timestamp()+interval '10 minutes',
   (((due->>'day')::date+1)::timestamp at time zone 'Europe/Stockholm'))));
 return true;
end $$;

create function komisio_private.fortnox_active_run(p_tenant uuid) returns public.access_events
language sql stable security definer set search_path='' as $$
 select e from public.access_events e join public.automation_grants g on g.id::text=e.detail->>'grantId'
 where e.tenant_id=p_tenant and e.action='fortnox.automatic_started' and e.actor_id=auth.uid()
  and e.detail->>'day'=((now() at time zone 'Europe/Stockholm')::date)::text
  and (e.detail->>'leaseUntil')::timestamptz>clock_timestamp()
  and g.tenant_id=p_tenant and g.scope='fortnox_send' and g.disabled_at is null and g.accepted_by=auth.uid()
  and not exists(select 1 from public.access_events f where f.tenant_id=p_tenant and f.action='fortnox.automatic_run' and f.target_id=e.target_id)
 order by e.id desc limit 1;
$$;

create or replace function public.fortnox_automatic_exports(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare run public.access_events; cutoff timestamptz;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then
  if not coalesce(komisio_private.automation_allowed(p_tenant,'fortnox_send'),false) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  run:=komisio_private.fortnox_active_run(p_tenant);
  if run.id is null then raise exception 'FORTNOX_RUN_NOT_ACTIVE';end if;
  cutoff:=(run.detail->>'cutoff')::timestamptz;
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('exportId',eligible.id) order by eligible.created_at,eligible.id),'[]') from (
  select e.id,e.created_at from public.accounting_exports e where e.tenant_id=p_tenant and (cutoff is null or e.created_at<=cutoff)
  and not exists(select 1 from public.fortnox_voucher_sends s where s.tenant_id=p_tenant and s.export_id=e.id
   and (s.status<>'failed' or s.error_code<>'FORTNOX_PREFLIGHT_FAILED'))
  order by e.created_at,e.id limit 100) eligible);
end $$;

create or replace function public.finish_fortnox_automatic_run(p_tenant uuid,p_id uuid,p_outcome text,p_sent integer) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.access_events; started public.access_events; detail jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'fortnox_send'),false) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_outcome is null or p_outcome not in ('complete','partial','failed') or p_sent is null or p_sent not between 0 and 100 then raise exception 'INVALID_INPUT';end if;
 select * into started from public.access_events where tenant_id=p_tenant and action='fortnox.automatic_started' and target_id=p_id;
 if not found or started.actor_id is distinct from actor then raise exception 'FORTNOX_RUN_NOT_ACTIVE';end if;
 detail:=jsonb_build_object('outcome',p_outcome,'sent',p_sent,'day',started.detail->>'day','grantId',started.detail->>'grantId');
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_id and action='fortnox.automatic_run';
 if found then
  if prior.actor_id<>actor or prior.detail<>detail then raise exception 'REQUEST_CONFLICT';end if;
  return;
 end if;
 perform komisio_private.record_access(p_tenant,'fortnox.automatic_run',p_id,detail);
end $$;

revoke all on function komisio_private.fortnox_scheduled_at(date,time),komisio_private.fortnox_daily_due(uuid,timestamptz),komisio_private.fortnox_active_run(uuid) from public,anon,authenticated;
revoke all on function public.fortnox_send_schedule(uuid),public.save_fortnox_send_schedule(uuid,uuid,uuid,text),public.begin_fortnox_automatic_run(uuid,uuid) from public,anon;
grant execute on function public.fortnox_send_schedule(uuid),public.save_fortnox_send_schedule(uuid,uuid,uuid,text),public.begin_fortnox_automatic_run(uuid,uuid) to authenticated;

-- Manual dispatch is unchanged; automatic dispatch must belong to the daily claim.
create or replace function public.begin_fortnox_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections; e public.accounting_exports; close public.day_closes; prior public.fortnox_voucher_sends; open_row public.fortnox_voucher_sends; run public.access_events;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',false);
 end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'FORTNOX_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 if coalesce(public.tenant_role(p_tenant),'')='automation' then
  run:=komisio_private.fortnox_active_run(p_tenant);
  if run.id is null or e.created_at>(run.detail->>'cutoff')::timestamptz then raise exception 'FORTNOX_RUN_NOT_ACTIVE';end if;
 end if;
 select * into open_row from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'FORTNOX_ALREADY_SENT'; end if;
  raise exception 'FORTNOX_SEND_IN_PROGRESS';
 end if;
 if exists(select 1 from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code not in ('FORTNOX_PREFLIGHT_FAILED','FORTNOX_WRONG_COMPANY')) then raise exception 'FORTNOX_OUTCOME_UNKNOWN'; end if;
 insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,'pending',uid);
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',true);
end $$;
