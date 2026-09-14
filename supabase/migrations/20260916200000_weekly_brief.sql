-- Weekly brief by e-mail: an owner switches it on per store as an
-- automation grant (scope weekly_brief); every Monday the automation
-- identity reads last week's brief for those stores and mails it to the
-- owners through the allowlisted transport, recorded once per store and
-- week. The brief reads open to the automation only with that scope.
alter table public.automation_grants drop constraint automation_grants_scope_check;
alter table public.automation_grants add constraint automation_grants_scope_check check(scope in ('zettle_pull','fortnox_send','weekly_brief'));
create or replace function public.enable_automation(p_tenant uuid,p_id uuid,p_scope text,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.automation_grants; address text:=lower(trim(p_identity_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_scope not in ('zettle_pull','fortnox_send','weekly_brief') or address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'INVALID_INPUT'; end if;
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

-- The two reads the brief needs, opened to the automation with the scope.
create or replace function public.economy_summary(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p_start timestamptz; p_end timestamptz; totals jsonb; days jsonb; liability record; open_payouts record;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') and not komisio_private.automation_allowed(p_tenant,'weekly_brief') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_INPUT'; end if;
 p_start:=(p_from::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 p_end:=((p_to+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 totals:=komisio_private.period_totals(p_tenant,p_start,p_end);
 select coalesce(jsonb_agg(jsonb_build_object('date',d.sale_day,'salesCount',d.n,'grossOre',d.gross,'sellerCreditOre',d.credit) order by d.sale_day),'[]'::jsonb) into days
 from (select (s.occurred_at at time zone 'Europe/Stockholm')::date as sale_day,count(distinct s.id)::int as n,sum(l.price_ore)::bigint gross,sum(l.seller_credit_ore)::bigint credit
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=p_start and s.occurred_at<p_end group by 1) d;
 select coalesce(sum(amount_ore),0)::bigint as available,coalesce(-sum(amount_ore) filter (where kind in ('payout_reserved','payout_released')),0)::bigint as reserved,
  count(distinct seller_id) filter (where amount_ore<>0)::int as sellers
 into liability from public.seller_ledger_entries where tenant_id=p_tenant;
 select count(*)::int as n,coalesce(sum(amount_ore),0)::bigint as total into open_payouts from public.payouts where tenant_id=p_tenant and status in ('requested','approved');
 return jsonb_build_object('from',p_from,'to',p_to,'timeZone','Europe/Stockholm','currency',komisio_private.store_currency(p_tenant),'totals',totals,'days',days,
  'liability',jsonb_build_object('availableOre',liability.available,'reservedOre',liability.reserved,'owedOre',liability.available+liability.reserved,'sellersWithEntries',liability.sellers),
  'openPayouts',jsonb_build_object('count',open_payouts.n,'amountOre',open_payouts.total));
end $$;
create or replace function public.economy_brief(p_tenant uuid,p_kind text,p_end date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare bounds jsonb; anchor date; cur jsonb; prev jsonb; accepted int; prev_accepted int; best jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') and not komisio_private.automation_allowed(p_tenant,'weekly_brief') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('week','month') then raise exception 'INVALID_INPUT'; end if;
 anchor:=coalesce(p_end,(now() at time zone 'Europe/Stockholm')::date-1);
 if anchor<date '2000-01-01' or anchor>((now() at time zone 'Europe/Stockholm')+interval '2 years')::date then raise exception 'INVALID_INPUT'; end if;
 bounds:=komisio_private.brief_period(p_kind,anchor);
 cur:=public.economy_summary(p_tenant,(bounds->>'from')::date,(bounds->>'to')::date);
 prev:=public.economy_summary(p_tenant,(bounds->>'previousFrom')::date,(bounds->>'previousTo')::date);
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant
  and i.accepted_at>=((bounds->>'from')||' 00:00')::timestamp at time zone 'Europe/Stockholm' and i.accepted_at<(((bounds->>'to')::date+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 select count(*)::int into prev_accepted from public.items i where i.tenant_id=p_tenant
  and i.accepted_at>=((bounds->>'previousFrom')||' 00:00')::timestamp at time zone 'Europe/Stockholm' and i.accepted_at<(((bounds->>'previousTo')::date+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 select d into best from jsonb_array_elements(cur->'days') d order by (d->>'grossOre')::bigint desc,d->>'date' limit 1;
 return jsonb_build_object('kind',p_kind,'anchor',anchor,'currency',cur->>'currency','timeZone','Europe/Stockholm',
  'period',jsonb_build_object('from',bounds->'from','to',bounds->'to'),'previousPeriod',jsonb_build_object('from',bounds->'previousFrom','to',bounds->'previousTo'),
  'current',cur->'totals','previous',prev->'totals','days',cur->'days','bestDay',best,
  'itemsAccepted',accepted,'previousItemsAccepted',prev_accepted,'liability',cur->'liability','openPayouts',cur->'openPayouts');
end $$;

create table public.brief_sends (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 week_start date not null,
 recipients integer not null check(recipients>=0),
 delivery text not null check(delivery in ('sent','manual','restricted','unconfirmed','failed','none')),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,week_start)
);
alter table public.brief_sends enable row level security;
revoke all on public.brief_sends from public,anon,authenticated;
grant select on public.brief_sends to authenticated;
create policy brief_sends_owner on public.brief_sends for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger brief_sends_immutable before update or delete on public.brief_sends for each row execute function komisio_private.preserve_payout_event();

-- Stores whose accepted weekly_brief grant belongs to the caller and whose brief for the given week is not sent yet.
create function public.due_weekly_briefs(p_week_start date) returns table(tenant_id uuid,store_name text,locale text,emails text[])
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if p_week_start is null or extract(isodow from p_week_start)<>1 then raise exception 'INVALID_INPUT'; end if;
 return query
 select g.tenant_id,t.name,
  coalesce((select nullif(pr.locale,'') from public.user_profiles pr join public.tenant_members m on m.user_id=pr.user_id where m.tenant_id=g.tenant_id and m.role='owner' order by m.created_at limit 1),'sv'),
  coalesce((select array_agg(lower(u.email) order by m.created_at) from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=g.tenant_id and m.role='owner' and u.email is not null),'{}'::text[])
 from public.automation_grants g join public.tenants t on t.id=g.tenant_id
 where g.scope='weekly_brief' and g.accepted_by=uid and g.disabled_at is null
  and komisio_private.automation_allowed(g.tenant_id,'weekly_brief')
  and not exists(select 1 from public.brief_sends s where s.tenant_id=g.tenant_id and s.week_start=p_week_start)
 order by t.created_at limit 200;
end $$;
create function public.record_brief_send(p_tenant uuid,p_week_start date,p_recipients integer,p_delivery text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if not komisio_private.automation_allowed(p_tenant,'weekly_brief') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_week_start is null or extract(isodow from p_week_start)<>1 or p_recipients is null or p_recipients<0 or p_delivery not in ('sent','manual','restricted','unconfirmed','failed','none') then raise exception 'INVALID_INPUT'; end if;
 insert into public.brief_sends(tenant_id,week_start,recipients,delivery,actor) values(p_tenant,p_week_start,p_recipients,p_delivery,uid) on conflict(tenant_id,week_start) do nothing;
 return found;
end $$;
revoke all on function public.due_weekly_briefs(date),public.record_brief_send(uuid,date,integer,text) from public,anon;
grant execute on function public.due_weekly_briefs(date),public.record_brief_send(uuid,date,integer,text) to authenticated;
