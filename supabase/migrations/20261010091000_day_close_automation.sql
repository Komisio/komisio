-- Owner-enabled preparation only. Financial totals and export/send rules are unchanged.
alter table public.automation_grants drop constraint automation_grants_scope_check;
alter table public.automation_grants add constraint automation_grants_scope_check
 check(scope in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull','day_close'));

create or replace function public.enable_automation(p_tenant uuid,p_id uuid,p_scope text,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.automation_grants; address text:=lower(trim(p_identity_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_scope is null or p_scope not in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull','day_close') or address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.automation_grants where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.scope<>p_scope or prior.enabled_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.automation_grant_state(prior);
 end if;
 if exists(select 1 from public.automation_grants where tenant_id=p_tenant and scope=p_scope and disabled_at is null) then raise exception 'AUTOMATION_ALREADY_ENABLED'; end if;
 insert into public.automation_grants(id,tenant_id,scope,identity_email,enabled_by) values(p_id,p_tenant,p_scope,address,uid) returning * into prior;
 perform komisio_private.record_access(p_tenant,'automation.enabled',p_id,jsonb_build_object('scope',p_scope));
 return komisio_private.automation_grant_state(prior);
end $$;

create index access_events_day_close_runs on public.access_events(tenant_id,id desc)
 where action='day_close.automatic_run';

-- A whole batch commits together. The audit record is also its durable cursor.
create function public.run_automatic_day_closes(p_tenant uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); g public.automation_grants; prior public.access_events;
 today date:=(now() at time zone 'Europe/Stockholm')::date; first_day date; last_day date; cursor_day date;
 day date; totals jsonb; close_id uuid; previous_id uuid; result jsonb;
 checked integer:=0; created integer:=0; unchanged integer:=0; skipped integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'day_close'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into strict g from public.automation_grants where tenant_id=p_tenant and scope='day_close' and disabled_at is null and accepted_by=actor;
 select * into prior from public.access_events where tenant_id=p_tenant and action='day_close.automatic_run' and target_id=p_id order by id desc limit 1;
 if found then
  if prior.actor_id is distinct from actor or prior.detail->>'grantId' is distinct from g.id::text then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.detail;
 end if;
 select (detail->>'through')::date into cursor_day from public.access_events
  where tenant_id=p_tenant and action='day_close.automatic_run' and detail->>'grantId'=g.id::text order by id desc limit 1;
 first_day:=(g.enabled_at at time zone 'Europe/Stockholm')::date;
 -- Revisit seven processed dates for late POS imports. Older corrections remain in reconciliation.
 if cursor_day is not null then first_day:=greatest(first_day,cursor_day-6); end if;
 last_day:=least(today-1,first_day+30);
 day:=first_day;
 while day<=last_day loop
  checked:=checked+1;
  select id into previous_id from public.day_closes where tenant_id=p_tenant and close_date=day order by version desc limit 1;
  totals:=komisio_private.day_close_totals(p_tenant,day);
  if previous_id is not null or (totals->>'salesCount')::int>0 or (totals->>'returnsCount')::int>0
   or (totals->>'payoutsPaidOre')::bigint<>0 or (totals->>'creditReversedOre')::bigint<>0 then
   close_id:=public.generate_day_close(p_tenant,gen_random_uuid(),day);
   if close_id is distinct from previous_id then created:=created+1; else unchanged:=unchanged+1; end if;
  else skipped:=skipped+1;
  end if;
  day:=day+1;
 end loop;
 result:=jsonb_build_object('grantId',g.id,'from',case when checked>0 then first_day end,
  'through',case when checked>0 then last_day end,'checked',checked,'created',created,'unchanged',unchanged,'skipped',skipped,
  'outcome',case when last_day<today-1 then 'partial' else 'complete' end);
 perform komisio_private.record_access(p_tenant,'day_close.automatic_run',p_id,result);
 return result;
end $$;

-- Oldest successful run first, so a time-limited worker resumes unfinished stores.
create function public.day_close_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return (select coalesce(jsonb_agg(jsonb_build_object('tenantId',eligible.tenant_id) order by eligible.last_at nulls first,eligible.tenant_id),'[]') from (
  select g.tenant_id,last_run.occurred_at as last_at from public.automation_grants g
  left join lateral (select occurred_at,detail from public.access_events e where e.tenant_id=g.tenant_id and e.action='day_close.automatic_run'
   and e.detail->>'grantId'=g.id::text order by e.id desc limit 1) last_run on true
  where g.scope='day_close' and g.disabled_at is null and g.accepted_by=auth.uid()
   and coalesce(komisio_private.automation_allowed(g.tenant_id,'day_close'),false)
   and (last_run.occurred_at is null or (last_run.occurred_at at time zone 'Europe/Stockholm')::date<(now() at time zone 'Europe/Stockholm')::date
    or last_run.detail->>'outcome'='partial')
  order by last_run.occurred_at nulls first,g.tenant_id limit 200
 ) eligible);
end $$;

create function public.day_close_automatic_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select e.detail||jsonb_build_object('at',e.occurred_at) from public.access_events e
  join public.automation_grants g on g.tenant_id=e.tenant_id and g.id::text=e.detail->>'grantId' and g.scope='day_close' and g.disabled_at is null
  where e.tenant_id=p_tenant and e.action='day_close.automatic_run' order by e.id desc limit 1);
end $$;
revoke all on function public.run_automatic_day_closes(uuid,uuid),public.day_close_automation_tenants(),public.day_close_automatic_status(uuid) from public,anon;
grant execute on function public.run_automatic_day_closes(uuid,uuid),public.day_close_automation_tenants(),public.day_close_automatic_status(uuid) to authenticated;

-- Identical totals/versioning; only the named scope gains completed-day access.
create or replace function public.generate_day_close(p_tenant uuid,p_id uuid,p_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.day_closes; latest public.day_closes; totals jsonb; same boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then
  if not coalesce(komisio_private.automation_allowed(p_tenant,'day_close'),false) or p_date is null
   or p_date>=(now() at time zone 'Europe/Stockholm')::date
   or not exists(select 1 from public.automation_grants g where g.tenant_id=p_tenant and g.scope='day_close'
    and g.accepted_by=uid and g.disabled_at is null and p_date>=(g.enabled_at at time zone 'Europe/Stockholm')::date)
  then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 end if;
 if p_id is null or p_date is null or p_date>(now() at time zone 'Europe/Stockholm')::date then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.day_closes where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.close_date is distinct from p_date or prior.generated_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 totals:=komisio_private.day_close_totals(p_tenant,p_date);
 select * into latest from public.day_closes where tenant_id=p_tenant and close_date=p_date order by version desc limit 1;
 if found then
  same:=latest.sales_count=(totals->>'salesCount')::int and latest.returns_count=(totals->>'returnsCount')::int and latest.gross_ore=(totals->>'grossOre')::bigint
   and latest.vat_ore=(totals->>'vatOre')::bigint and latest.commission_ore=(totals->>'commissionOre')::bigint and latest.commission_vat_ore=(totals->>'commissionVatOre')::bigint
   and latest.seller_credit_ore=(totals->>'sellerCreditOre')::bigint and latest.refunds_ore=(totals->>'refundsOre')::bigint and latest.credit_reversed_ore=(totals->>'creditReversedOre')::bigint
   and latest.payouts_paid_ore=(totals->>'payoutsPaidOre')::bigint and latest.per_mode=totals->'perMode';
  -- An unchanged day is not a new fact: the existing version stands.
  if same then return latest.id; end if;
 end if;
 insert into public.day_closes(id,tenant_id,close_date,version,sales_count,returns_count,gross_ore,vat_ore,commission_ore,commission_vat_ore,seller_credit_ore,refunds_ore,credit_reversed_ore,payouts_paid_ore,per_mode,generated_by)
 values(p_id,p_tenant,p_date,coalesce(latest.version,0)+1,(totals->>'salesCount')::int,(totals->>'returnsCount')::int,(totals->>'grossOre')::bigint,(totals->>'vatOre')::bigint,
  (totals->>'commissionOre')::bigint,(totals->>'commissionVatOre')::bigint,(totals->>'sellerCreditOre')::bigint,(totals->>'refundsOre')::bigint,(totals->>'creditReversedOre')::bigint,(totals->>'payoutsPaidOre')::bigint,totals->'perMode',uid);
 perform komisio_private.record_access(p_tenant,'day_close.generated',p_id,jsonb_build_object('date',p_date,'version',coalesce(latest.version,0)+1));
 return p_id;
end $$;
revoke all on function public.generate_day_close(uuid,uuid,date) from public,anon;
grant execute on function public.generate_day_close(uuid,uuid,date) to authenticated;
