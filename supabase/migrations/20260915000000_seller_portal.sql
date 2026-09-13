-- Seller session projections. No seller gains tenant membership or raw table access.
create function komisio_private.require_seller(p_tenant uuid,p_seller uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); address text;
begin
 select lower(trim(email)) into address from auth.users where id=uid;
 if address is null or address='' or not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller and lower(trim(email))=address)
 or (select count(*) from public.sellers where tenant_id=p_tenant and lower(trim(email))=address)<>1 then
 raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return uid;
end $$;
revoke all on function komisio_private.require_seller(uuid,uuid) from public,anon,authenticated;
create function public.my_seller_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('tenantId',s.tenant_id,'sellerId',s.id,'storeName',t.name) order by t.name,s.id),'[]') into result
 from public.sellers s join public.tenants t on t.id=s.tenant_id join auth.users u on u.id=uid
 where s.email<>'' and lower(trim(s.email))=lower(trim(u.email))
 and (select count(*) from public.sellers x where x.tenant_id=s.tenant_id and lower(trim(x.email))=lower(trim(u.email)))=1;
 return result;
end $$;
create function komisio_private.seller_balance_facts(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare available bigint; reserved bigint; credited bigint; paid bigint; entries integer;
begin
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select coalesce(sum(amount_ore),0),
  coalesce(-sum(amount_ore) filter (where kind in ('payout_reserved','payout_released')),0),
  coalesce(sum(amount_ore) filter (where kind='credit_sale'),0),
  coalesce(-sum(amount_ore) filter (where kind='payout_paid'),0),
  count(*)
 into available,reserved,credited,paid,entries
 from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller;
 return jsonb_build_object('sellerId',p_seller,'availableOre',available,'reservedOre',reserved,'creditedOre',credited,'paidOre',paid,'entries',entries);
end $$;

revoke all on function komisio_private.seller_balance_facts(uuid,uuid) from public,anon,authenticated;
create or replace function public.seller_balance(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.seller_balance_facts(p_tenant,p_seller);
end $$;
create function komisio_private.payout_threshold_ore(p_tenant uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select round(coalesce((select (policy->>'minPayoutThreshold')::numeric from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1),100)*100)::bigint;
$$;
revoke all on function komisio_private.payout_threshold_ore(uuid) from public,anon,authenticated;
create table public.seller_notification_preferences (
 id uuid primary key, tenant_id uuid not null, seller_id uuid not null,
 automatic_emails boolean not null, actor uuid not null references auth.users(id),
 seq bigint generated always as identity, created_at timestamptz not null default now(),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
alter table public.seller_notification_preferences enable row level security;
revoke all on public.seller_notification_preferences from public,anon,authenticated;
grant select on public.seller_notification_preferences to authenticated;
create policy seller_notification_preferences_staff on public.seller_notification_preferences for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create trigger seller_notification_preferences_immutable before update or delete on public.seller_notification_preferences for each row execute function komisio_private.preserve_ledger();
create index seller_notification_preferences_latest on public.seller_notification_preferences(tenant_id,seller_id,seq desc);
create function public.set_my_seller_notifications(p_tenant uuid,p_seller uuid,p_id uuid,p_enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_notification_preferences;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_notification_preferences where id=p_id;
 if found then
 if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.actor is distinct from uid or prior.automatic_emails is distinct from p_enabled then raise exception 'REQUEST_CONFLICT'; end if;
 return p_id; end if;
 insert into public.seller_notification_preferences(id,tenant_id,seller_id,automatic_emails,actor) values(p_id,p_tenant,p_seller,p_enabled,uid);
 return p_id;
end $$;
alter table public.payouts add column request_source text not null default 'staff' check(request_source in ('staff','seller'));
create function komisio_private.request_payout_core(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint,p_source text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.payouts; threshold bigint; available bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if p_source='seller' then perform komisio_private.require_seller(p_tenant,p_seller);
 elsif p_source is distinct from 'staff' or coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_amount_ore is null or p_amount_ore<=0 or p_amount_ore>99999999999 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.payouts where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.amount_ore is distinct from p_amount_ore or prior.requested_by is distinct from uid or prior.request_source is distinct from p_source then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 threshold:=komisio_private.payout_threshold_ore(p_tenant);
 if p_amount_ore<threshold then raise exception 'PAYOUT_BELOW_THRESHOLD'; end if;
 available:=komisio_private.available_ore(p_tenant,p_seller);
 if p_amount_ore>available then raise exception 'PAYOUT_EXCEEDS_BALANCE'; end if;
 insert into public.payouts(id,tenant_id,seller_id,amount_ore,requested_by,request_source) values(p_id,p_tenant,p_seller,p_amount_ore,uid,p_source);
 insert into public.payout_events(id,tenant_id,payout_id,kind,actor) values(p_id,p_tenant,p_id,'requested',uid);
 perform komisio_private.record_access(p_tenant,'payout.requested',p_id,jsonb_build_object('seller_id',p_seller,'amount_ore',p_amount_ore));
 return p_id;
end $$;

revoke all on function komisio_private.request_payout_core(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
create or replace function public.request_payout(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint) returns uuid
language sql security definer set search_path='' as $$select komisio_private.request_payout_core(p_tenant,p_id,p_seller,p_amount_ore,'staff')$$;
create function public.request_my_payout(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint) returns uuid
language sql security definer set search_path='' as $$select komisio_private.request_payout_core(p_tenant,p_id,p_seller,p_amount_ore,'seller')$$;
create function public.my_seller_economy(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; entries jsonb; statements jsonb; messages jsonb; payouts jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into entries from (select id,kind,amount_ore,reference_kind,reference_id,occurred_at from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller order by occurred_at desc,id limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into statements from (select id,number,kind,corrects_id,period_from,period_to,opening_ore,closing_ore,issued_at from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller order by number desc limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into messages from (select id,kind,subject,body,status,queued_at,delivered_at from public.seller_communications where tenant_id=p_tenant and seller_id=p_seller order by queued_at desc,id limit 100) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into payouts from (select id,amount_ore,status,request_source,requested_at from public.payouts where tenant_id=p_tenant and seller_id=p_seller order by requested_at desc,id limit 100) x;
 return jsonb_build_object('balance',komisio_private.seller_balance_facts(p_tenant,p_seller),'ledger',entries,'statements',statements,'messages',messages,'payouts',payouts,'limit',100,
 'thresholdOre',komisio_private.payout_threshold_ore(p_tenant),
 'automaticEmails',coalesce((select automatic_emails from public.seller_notification_preferences where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1),true));
end $$;
create function public.my_seller_statement(p_tenant uuid,p_seller uuid,p_statement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare header jsonb; lines jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select to_jsonb(s)-'issued_by'-'tenant_id'-'seller_id' into header from public.settlement_statements s where tenant_id=p_tenant and seller_id=p_seller and id=p_statement;
 if header is null then raise exception 'STATEMENT_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(l)-'tenant_id' order by l.line_no),'[]') into lines from public.settlement_statement_lines l where tenant_id=p_tenant and statement_id=p_statement;
 return jsonb_build_object('header',header,'lines',lines);
end $$;
revoke all on function public.my_seller_accounts(),public.my_seller_economy(uuid,uuid),public.my_seller_statement(uuid,uuid,uuid),public.request_my_payout(uuid,uuid,uuid,bigint),public.set_my_seller_notifications(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.my_seller_accounts(),public.my_seller_economy(uuid,uuid),public.my_seller_statement(uuid,uuid,uuid),public.request_my_payout(uuid,uuid,uuid,bigint),public.set_my_seller_notifications(uuid,uuid,uuid,boolean) to authenticated;
