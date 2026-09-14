-- Plans slice 3 (owner decision C4): Stripe as the payment provider. Stripe
-- owns prices, invoices and the customer portal; Komisio records the
-- outcome of each webhook event once, through one function, as a
-- dedicated billing actor (the deployment's automation identity, registered
-- by the operator). Hosts of kind 'person' keep manual activation; the
-- billing actor can do nothing else.
alter table public.platform_hosts add column kind text not null default 'person' check(kind in ('person','billing'));
create or replace function public.is_platform_host() returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.platform_hosts where user_id=auth.uid() and kind='person') and public.verified_session(); $$;
create function komisio_private.is_billing_actor() returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.platform_hosts where user_id=auth.uid() and kind='billing') and public.verified_session(); $$;
revoke all on function komisio_private.is_billing_actor() from public,anon,authenticated;
-- Operator (database owner) registers the automation identity as the billing actor.
create function komisio_private.register_billing_actor(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'INVALID_INPUT'; end if;
 insert into public.platform_hosts(user_id,kind) values(p_user,'billing') on conflict(user_id) do update set kind='billing';
end $$;
revoke all on function komisio_private.register_billing_actor(uuid) from public,anon,authenticated;

alter table public.tenant_plan_events drop constraint tenant_plan_events_kind_check;
alter table public.tenant_plan_events add constraint tenant_plan_events_kind_check check(kind in ('trial_started','activated','trial_expired','grace_expired','activation_expired','closed','reopened','payment_failed','cancel_scheduled','subscription_ended','provider_event'));

create table public.billing_events (
 id text primary key check(length(id) between 1 and 100),
 type text not null check(length(type) between 1 and 100),
 tenant_id uuid references public.tenants(id),
 outcome text not null check(outcome in ('active','past_due','read_only','cancel_at_period_end','none','unmatched')),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from public,anon,authenticated;
grant select on public.billing_events to authenticated;
create policy billing_events_hosts on public.billing_events for select to authenticated using(public.is_platform_host());
create trigger billing_events_immutable before update or delete on public.billing_events for each row execute function komisio_private.preserve_payout_event();

-- One provider event becomes at most one plan transition. The tenant is
-- named by the event (checkout reference or subscription metadata) or found
-- through the subscription or customer id already on the plan.
create function public.record_billing_event(p_event_id text,p_type text,p_tenant uuid,p_customer text,p_subscription text,p_outcome text,p_period_end timestamptz,p_detail jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); p public.tenant_plans; tenant uuid:=p_tenant; prior text; kind text; to_state text;
begin
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then raise exception 'BILLING_DISABLED'; end if;
 if p_event_id is null or length(p_event_id) not between 1 and 100 or p_type is null or p_outcome not in ('active','past_due','read_only','cancel_at_period_end','none') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.billing_events where id=p_event_id) then return jsonb_build_object('replayed',true); end if;
 if tenant is null and coalesce(p_subscription,'')<>'' then select tenant_id into tenant from public.tenant_plans where provider='stripe' and provider_subscription_id=p_subscription; end if;
 if tenant is null and coalesce(p_customer,'')<>'' then select tenant_id into tenant from public.tenant_plans where provider='stripe' and provider_customer_id=p_customer; end if;
 if tenant is null or not exists(select 1 from public.tenants where id=tenant) then
  insert into public.billing_events(id,type,tenant_id,outcome,detail) values(p_event_id,p_type,null,'unmatched',p_detail);
  return jsonb_build_object('replayed',false,'matched',false);
 end if;
 perform 1 from public.tenants where id=tenant for update;
 select * into p from public.tenant_plans where tenant_id=tenant;
 prior:=p.state;
 insert into public.billing_events(id,type,tenant_id,outcome,detail) values(p_event_id,p_type,tenant,p_outcome,p_detail);
 if p_outcome='none' or prior='closed' then return jsonb_build_object('replayed',false,'matched',true,'state',coalesce(prior,'active')); end if;
 to_state:=case p_outcome when 'active' then 'active' when 'cancel_at_period_end' then 'active' when 'past_due' then 'past_due' else 'read_only' end;
 kind:=case p_outcome when 'active' then 'activated' when 'cancel_at_period_end' then 'cancel_scheduled' when 'past_due' then 'payment_failed' else 'subscription_ended' end;
 perform set_config('komisio.plan_transition','engine',true);
 if p.tenant_id is null then
  insert into public.tenant_plans(tenant_id,state,provider,deadline_set_by,provider_customer_id,provider_subscription_id,grace_ends_at,active_until)
  values(tenant,to_state,'stripe',uid,coalesce(p_customer,''),coalesce(p_subscription,''),case when to_state='past_due' then now()+interval '14 days' end,case when p_outcome='cancel_at_period_end' then p_period_end end);
 else
  update public.tenant_plans set state=to_state,provider='stripe',deadline_set_by=uid,updated_at=now(),
   provider_customer_id=coalesce(nullif(p_customer,''),provider_customer_id),provider_subscription_id=coalesce(nullif(p_subscription,''),provider_subscription_id),
   trial_ends_at=case when to_state='active' then null else trial_ends_at end,
   grace_ends_at=case when to_state='past_due' then coalesce(case when prior='past_due' then grace_ends_at end,now()+interval '14 days') else null end,
   active_until=case when p_outcome='cancel_at_period_end' then p_period_end else null end
  where tenant_id=tenant;
 end if;
 perform set_config('komisio.plan_transition','',true);
 perform komisio_private.plan_event(tenant,kind,prior,to_state,jsonb_build_object('eventId',p_event_id,'type',p_type,'periodEnd',p_period_end),uid);
 return jsonb_build_object('replayed',false,'matched',true,'state',to_state);
end $$;

-- A dated activation ends on its date whatever the provider (cancel at period end).
create or replace function komisio_private.expire_plans() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p record; n int:=0;
begin
 if not komisio_private.billing_enabled() then return jsonb_build_object('expired',0); end if;
 for p in select * from public.tenant_plans where (state='trial' and trial_ends_at<=now()) or (state='past_due' and grace_ends_at<=now()) or (state='active' and active_until is not null and active_until<=now()) for update loop
  perform 1 from public.tenants where id=p.tenant_id for update;
  perform set_config('komisio.plan_transition','engine',true);
  update public.tenant_plans set state='read_only',updated_at=now() where tenant_id=p.tenant_id;
  perform set_config('komisio.plan_transition','',true);
  perform komisio_private.plan_event(p.tenant_id,case p.state when 'trial' then 'trial_expired' when 'past_due' then 'grace_expired' else 'activation_expired' end,p.state,'read_only','{}'::jsonb,p.deadline_set_by);
  n:=n+1;
 end loop;
 return jsonb_build_object('expired',n);
end $$;

-- The owner's own provider ids, for the customer portal; never shown to other roles.
create function public.billing_customer(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.tenant_plans;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into p from public.tenant_plans where tenant_id=p_tenant;
 if not found or p.provider<>'stripe' then return null; end if;
 return jsonb_build_object('customerId',nullif(p.provider_customer_id,''),'subscriptionId',nullif(p.provider_subscription_id,''));
end $$;
revoke all on function public.record_billing_event(text,text,uuid,text,text,text,timestamptz,jsonb),public.billing_customer(uuid) from public,anon;
grant execute on function public.record_billing_event(text,text,uuid,text,text,text,timestamptz,jsonb),public.billing_customer(uuid) to authenticated;
