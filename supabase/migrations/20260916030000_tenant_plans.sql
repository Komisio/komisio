-- Plans and trial (owner decisions C1 to C6, 2026-09-14): hosted Komisio is
-- one plan per store with a 30-day trial from store creation; a store whose
-- trial or grace has passed becomes read-only. The state is commercial, not
-- a security boundary: roles and RLS are untouched, and one gate,
-- komisio_private.require_writable, refuses new facts. Billing is off until
-- the host enables it, so self-hosted deployments never see a plan row.
-- No payment provider in this migration: the host activates by hand.
create table public.platform_settings (
 only_row boolean primary key default true check(only_row),
 billing_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.platform_settings default values;
create table public.platform_hosts (
 user_id uuid primary key references auth.users(id),
 added_at timestamptz not null default now()
);
create table public.tenant_plans (
 tenant_id uuid primary key references public.tenants(id),
 state text not null check(state in ('trial','active','past_due','read_only','closed')),
 provider text not null default 'none' check(provider in ('none','manual','stripe')),
 trial_ends_at timestamptz,
 grace_ends_at timestamptz,
 active_until timestamptz,
 deadline_set_by uuid not null references auth.users(id),
 provider_customer_id text not null default '' check(length(provider_customer_id)<=100),
 provider_subscription_id text not null default '' check(length(provider_subscription_id)<=100),
 updated_at timestamptz not null default now()
);
create table public.tenant_plan_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('trial_started','activated','trial_expired','grace_expired','activation_expired','closed','reopened')),
 from_state text,
 to_state text not null,
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index tenant_plan_events_tenant on public.tenant_plan_events(tenant_id,occurred_at desc);
alter table public.platform_settings enable row level security;
alter table public.platform_hosts enable row level security;
alter table public.tenant_plans enable row level security;
alter table public.tenant_plan_events enable row level security;
revoke all on public.platform_settings,public.platform_hosts,public.tenant_plans,public.tenant_plan_events from public,anon,authenticated;
grant select on public.tenant_plans,public.tenant_plan_events to authenticated;
create policy platform_settings_none on public.platform_settings for select to authenticated using(false);
create policy platform_hosts_self on public.platform_hosts for select to authenticated using(user_id=auth.uid());
create policy tenant_plans_members on public.tenant_plans for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy tenant_plan_events_owner on public.tenant_plan_events for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger tenant_plan_events_immutable before update or delete on public.tenant_plan_events for each row execute function komisio_private.preserve_payout_event();
create function komisio_private.guard_tenant_plan() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.plan_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PLAN' using errcode='55000'; end if;
 if tg_op='DELETE' then raise exception 'IMMUTABLE_PLAN' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_tenant_plan() from public,anon,authenticated;
create trigger tenant_plans_guard before update or delete on public.tenant_plans for each row execute function komisio_private.guard_tenant_plan();

create function komisio_private.billing_enabled() returns boolean
language sql stable security definer set search_path='' as $$ select billing_enabled from public.platform_settings; $$;
create function public.is_platform_host() returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.platform_hosts where user_id=auth.uid()) and public.verified_session(); $$;
revoke all on function komisio_private.billing_enabled() from public,anon,authenticated;
revoke all on function public.is_platform_host() from public,anon;
grant execute on function public.is_platform_host() to authenticated;

create function komisio_private.plan_event(p_tenant uuid,p_kind text,p_from text,p_to text,p_detail jsonb,p_actor uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.tenant_plan_events(tenant_id,kind,from_state,to_state,detail,actor) values(p_tenant,p_kind,p_from,p_to,coalesce(p_detail,'{}'::jsonb),p_actor);
$$;
revoke all on function komisio_private.plan_event(uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;

-- Store creation starts the trial while billing is enabled.
create function komisio_private.start_trial() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if komisio_private.billing_enabled() then
  perform set_config('komisio.plan_transition','engine',true);
  insert into public.tenant_plans(tenant_id,state,trial_ends_at,deadline_set_by) values(new.id,'trial',now()+interval '30 days',new.created_by);
  perform set_config('komisio.plan_transition','',true);
  perform komisio_private.plan_event(new.id,'trial_started',null,'trial',jsonb_build_object('trialEndsAt',now()+interval '30 days'),new.created_by);
 end if;
 return new;
end $$;
revoke all on function komisio_private.start_trial() from public,anon,authenticated;
create trigger tenants_start_trial after insert on public.tenants for each row execute function komisio_private.start_trial();

-- The one gate. No plan row (billing off, or a store older than billing) means writable.
create function komisio_private.require_writable(p_tenant uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare s text;
begin
 if not komisio_private.billing_enabled() then return; end if;
 select state into s from public.tenant_plans where tenant_id=p_tenant;
 if s in ('read_only','closed') then raise exception 'PLAN_READ_ONLY' using errcode='55000'; end if;
end $$;
revoke all on function komisio_private.require_writable(uuid) from public,anon,authenticated;
create function komisio_private.plan_gate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_writable(new.tenant_id);
 return new;
end $$;
revoke all on function komisio_private.plan_gate() from public,anon,authenticated;
do $gate$ declare t text; begin
 foreach t in array array['sellers','bag_receipts','garment_receipts','reception_sessions','purchase_receipts','items','item_prices','sales','sale_returns','payouts','pending_operations','markdown_runs','seller_handovers'] loop
  execute format('create trigger plan_gate before insert on public.%I for each row execute function komisio_private.plan_gate()',t);
 end loop;
end $gate$;

-- What members see: the state and its dates; never provider ids.
create function public.plan_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.tenant_plans;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly','automation') and not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then return jsonb_build_object('billing',false,'state','active','writable',true); end if;
 select * into p from public.tenant_plans where tenant_id=p_tenant;
 if not found then return jsonb_build_object('billing',true,'state','active','writable',true,'provider','none'); end if;
 return jsonb_build_object('billing',true,'state',p.state,'writable',p.state not in ('read_only','closed'),'provider',p.provider,'trialEndsAt',p.trial_ends_at,'graceEndsAt',p.grace_ends_at,'activeUntil',p.active_until,
  'daysLeft',case when p.state='trial' then greatest(0,ceil(extract(epoch from p.trial_ends_at-now())/86400))::int when p.state='past_due' then greatest(0,ceil(extract(epoch from p.grace_ends_at-now())/86400))::int end);
end $$;

-- Daily: trials, grace periods and manual activations that have passed become read-only.
create function komisio_private.expire_plans() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p record; n int:=0;
begin
 if not komisio_private.billing_enabled() then return jsonb_build_object('expired',0); end if;
 for p in select * from public.tenant_plans where (state='trial' and trial_ends_at<=now()) or (state='past_due' and grace_ends_at<=now()) or (state='active' and provider='manual' and active_until is not null and active_until<=now()) for update loop
  perform 1 from public.tenants where id=p.tenant_id for update;
  perform set_config('komisio.plan_transition','engine',true);
  update public.tenant_plans set state='read_only',updated_at=now() where tenant_id=p.tenant_id;
  perform set_config('komisio.plan_transition','',true);
  perform komisio_private.plan_event(p.tenant_id,case p.state when 'trial' then 'trial_expired' when 'past_due' then 'grace_expired' else 'activation_expired' end,p.state,'read_only','{}'::jsonb,p.deadline_set_by);
  n:=n+1;
 end loop;
 return jsonb_build_object('expired',n);
end $$;
revoke all on function komisio_private.expire_plans() from public,anon,authenticated;
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('komisio-expire-plans','45 3 * * *','select komisio_private.expire_plans()');
 end if;
end $cron$;

-- Host: manual activation for invoice customers and the pilot; recorded with a reason.
create function public.activate_plan_manually(p_tenant uuid,p_until timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); p public.tenant_plans; prior text;
begin
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then raise exception 'BILLING_DISABLED'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 or (p_until is not null and p_until<=now()) then raise exception 'INVALID_INPUT'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'TENANT_NOT_FOUND'; end if;
 select * into p from public.tenant_plans where tenant_id=p_tenant;
 prior:=p.state;
 if prior='closed' then raise exception 'PLAN_CLOSED'; end if;
 perform set_config('komisio.plan_transition','engine',true);
 if p.tenant_id is null then
  insert into public.tenant_plans(tenant_id,state,provider,active_until,deadline_set_by) values(p_tenant,'active','manual',p_until,uid);
 else
  update public.tenant_plans set state='active',provider='manual',active_until=p_until,grace_ends_at=null,deadline_set_by=uid,updated_at=now() where tenant_id=p_tenant;
 end if;
 perform set_config('komisio.plan_transition','',true);
 perform komisio_private.plan_event(p_tenant,'activated',prior,'active',jsonb_build_object('reason',trim(p_reason),'activeUntil',p_until,'provider','manual'),uid);
 return public.plan_status(p_tenant);
end $$;

create function public.host_plan_overview() returns table(tenant_id uuid,name text,slug text,state text,provider text,trial_ends_at timestamptz,grace_ends_at timestamptz,active_until timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return query select t.id,t.name,t.slug,coalesce(p.state,'active'),coalesce(p.provider,'none'),p.trial_ends_at,p.grace_ends_at,p.active_until,t.created_at
  from public.tenants t left join public.tenant_plans p on p.tenant_id=t.id order by t.created_at desc limit 500;
end $$;

-- The owner closes a store: read-only for everyone; export stays open.
create function public.close_store(p_tenant uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then raise exception 'BILLING_DISABLED'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select state into prior from public.tenant_plans where tenant_id=p_tenant;
 if prior='closed' then return public.plan_status(p_tenant); end if;
 perform set_config('komisio.plan_transition','engine',true);
 if prior is null then insert into public.tenant_plans(tenant_id,state,deadline_set_by) values(p_tenant,'closed',uid);
 else update public.tenant_plans set state='closed',updated_at=now() where tenant_id=p_tenant; end if;
 perform set_config('komisio.plan_transition','',true);
 perform komisio_private.plan_event(p_tenant,'closed',prior,'closed',jsonb_build_object('reason',trim(p_reason)),uid);
 perform komisio_private.record_access(p_tenant,'store.closed',p_tenant,jsonb_build_object('reason',trim(p_reason)));
 return public.plan_status(p_tenant);
end $$;

-- Host one-time switch (DB owner runs it): turns billing on and keeps every
-- existing store active on a manual plan without an end date.
create function komisio_private.enable_billing(p_host uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t record; n int:=0;
begin
 if p_host is null or not exists(select 1 from auth.users where id=p_host) then raise exception 'INVALID_INPUT'; end if;
 insert into public.platform_hosts(user_id) values(p_host) on conflict do nothing;
 update public.platform_settings set billing_enabled=true,updated_at=now();
 for t in select id,created_by from public.tenants where id not in (select tenant_id from public.tenant_plans) loop
  perform set_config('komisio.plan_transition','engine',true);
  insert into public.tenant_plans(tenant_id,state,provider,deadline_set_by) values(t.id,'active','manual',p_host);
  perform set_config('komisio.plan_transition','',true);
  perform komisio_private.plan_event(t.id,'activated',null,'active',jsonb_build_object('reason','existing store at billing start','provider','manual'),p_host);
  n:=n+1;
 end loop;
 return jsonb_build_object('existingStoresActivated',n);
end $$;
revoke all on function komisio_private.enable_billing(uuid) from public,anon,authenticated;
revoke all on function public.plan_status(uuid),public.activate_plan_manually(uuid,timestamptz,text),public.host_plan_overview(),public.close_store(uuid,text) from public,anon;
grant execute on function public.plan_status(uuid),public.activate_plan_manually(uuid,timestamptz,text),public.host_plan_overview(),public.close_store(uuid,text) to authenticated;
