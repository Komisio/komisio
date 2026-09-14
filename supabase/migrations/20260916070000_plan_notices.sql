-- Plans slice 2, part two: trial notices. Three moments per trial (one week
-- left, tomorrow, ended) and one for a payment grace period. The billing
-- actor reads what is due and records what was sent, once per store and
-- kind; the e-mail itself is sent by the application through the same
-- allowlisted transport as seller messages.
create table public.plan_notices (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('trial_week','trial_tomorrow','trial_ended','grace_week')),
 recipients integer not null check(recipients>=0),
 delivery text not null check(delivery in ('sent','manual','restricted','unconfirmed','failed','none')),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,kind)
);
alter table public.plan_notices enable row level security;
revoke all on public.plan_notices from public,anon,authenticated;
grant select on public.plan_notices to authenticated;
create policy plan_notices_owner on public.plan_notices for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin') or public.is_platform_host());
create trigger plan_notices_immutable before update or delete on public.plan_notices for each row execute function komisio_private.preserve_payout_event();

-- Stores that need a notice now, with their owners' addresses. Billing actor only.
create function public.due_plan_notices() returns table(tenant_id uuid,store_name text,kind text,deadline timestamptz,locale text,emails text[])
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.billing_enabled() then return; end if;
 return query
 with due as (
  select p.tenant_id,'trial_week'::text as kind,p.trial_ends_at as deadline from public.tenant_plans p where p.state='trial' and p.trial_ends_at<=now()+interval '7 days'
  union all
  select p.tenant_id,'trial_tomorrow',p.trial_ends_at from public.tenant_plans p where p.state='trial' and p.trial_ends_at<=now()+interval '1 day'
  union all
  select p.tenant_id,'trial_ended',p.trial_ends_at from public.tenant_plans p where p.state='read_only' and p.provider='none' and p.trial_ends_at is not null and p.trial_ends_at>now()-interval '3 days'
  union all
  select p.tenant_id,'grace_week',p.grace_ends_at from public.tenant_plans p where p.state='past_due' and p.grace_ends_at<=now()+interval '7 days'
 )
 select d.tenant_id,t.name,d.kind,d.deadline,
  coalesce((select nullif(pr.locale,'') from public.user_profiles pr join public.tenant_members m on m.user_id=pr.user_id where m.tenant_id=d.tenant_id and m.role='owner' order by m.created_at limit 1),'sv'),
  coalesce((select array_agg(lower(u.email) order by m.created_at) from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=d.tenant_id and m.role='owner' and u.email is not null),'{}'::text[])
 from due d join public.tenants t on t.id=d.tenant_id
 where not exists(select 1 from public.plan_notices n where n.tenant_id=d.tenant_id and n.kind=d.kind)
 order by d.deadline,d.tenant_id limit 200;
end $$;

create function public.record_plan_notice(p_tenant uuid,p_kind text,p_recipients integer,p_delivery text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if not komisio_private.is_billing_actor() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('trial_week','trial_tomorrow','trial_ended','grace_week') or p_recipients is null or p_recipients<0 or p_delivery not in ('sent','manual','restricted','unconfirmed','failed','none') then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'TENANT_NOT_FOUND'; end if;
 insert into public.plan_notices(tenant_id,kind,recipients,delivery,actor) values(p_tenant,p_kind,p_recipients,p_delivery,uid) on conflict(tenant_id,kind) do nothing;
 return found;
end $$;
revoke all on function public.due_plan_notices(),public.record_plan_notice(uuid,text,integer,text) from public,anon;
grant execute on function public.due_plan_notices(),public.record_plan_notice(uuid,text,integer,text) to authenticated;
