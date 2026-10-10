-- Seller-wide monthly fees. All amounts are numeric minor units, rounded in SQL.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_fees(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_fees(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare fee jsonb;
begin
 if not komisio_private.valid_store_policy_before_fees(value#-'{consignmentPeriod,monthlyFee}') then return false; end if;
 if not coalesce(value->'consignmentPeriod' ? 'monthlyFee',false) then return true; end if;
 fee:=value->'consignmentPeriod'->'monthlyFee';
 if jsonb_typeof(fee)<>'object' or not(fee ?& array['amountOre','vatBasis','vatRatePercent','collection'])
  or fee-array['amountOre','vatBasis','vatRatePercent','collection']<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(fee->'amountOre')<>'number' or jsonb_typeof(fee->'vatRatePercent')<>'number'
  or jsonb_typeof(fee->'vatBasis')<>'string' or jsonb_typeof(fee->'collection')<>'string' then return false; end if;
 return (fee->>'amountOre')::numeric between 1 and 9999999999 and (fee->>'amountOre')::numeric=trunc((fee->>'amountOre')::numeric)
  and (fee->>'vatRatePercent')::numeric between 0 and 100 and (fee->>'vatRatePercent')::numeric=round((fee->>'vatRatePercent')::numeric,2)
  and fee->>'vatBasis' in ('inclusive','exclusive') and fee->>'collection' in ('balance','separate');
end $$;

create table public.seller_consignment_periods (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), seller_id uuid not null,
 started_at timestamptz not null check(isfinite(started_at)), policy_id uuid not null, fee_terms jsonb not null,
 currency text not null, authorized_by uuid not null references auth.users(id), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(tenant_id,id), unique(tenant_id,seller_id,started_at),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,policy_id) references public.store_policy_versions(tenant_id,id)
);
create table public.consignment_fees (
 id uuid primary key, tenant_id uuid not null references public.tenants(id), seller_id uuid not null, period_id uuid not null,
 month_index integer not null check(month_index>=0), starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 net_ore numeric(14,0) not null check(net_ore>=0), vat_ore numeric(14,0) not null check(vat_ore>=0),
 gross_ore numeric(14,0) not null check(gross_ore=net_ore+vat_ore and gross_ore<=99999999999),
 collection text not null check(collection in ('balance','separate')), currency text not null,
 recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
 unique(tenant_id,id), unique(period_id,month_index),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,period_id) references public.seller_consignment_periods(tenant_id,id)
);
create index consignment_fees_seller on public.consignment_fees(tenant_id,seller_id,starts_at desc,id);
create table public.consignment_fee_events (
 id uuid primary key, tenant_id uuid not null references public.tenants(id), fee_id uuid not null,
 kind text not null check(kind in ('paid','reversed')), reference text not null default '' check(length(reference)<=200),
 reason text not null default '' check(length(reason)<=500), actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(), unique(fee_id,kind),
 foreign key(tenant_id,fee_id) references public.consignment_fees(tenant_id,id),
 check((kind='paid' and length(trim(reference))>0) or (kind='reversed' and length(trim(reason))>0))
);
alter table public.consignment_receipt_periods add column billing_period_id uuid;
alter table public.consignment_receipt_periods add foreign key(tenant_id,billing_period_id) references public.seller_consignment_periods(tenant_id,id);
do $$ declare t text; begin
 foreach t in array array['seller_consignment_periods','consignment_fees','consignment_fee_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy member_read on public.%I for select to authenticated using(tenant_id in(select public.user_tenant_ids()))',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function komisio_private.preserve_consignment_period()',t);
 end loop;
end $$;

alter table public.seller_ledger_entries drop constraint seller_ledger_entries_kind_check;
alter table public.seller_ledger_entries add constraint seller_ledger_entries_kind_check check(kind in
 ('credit_sale','credit_reversal','payout_reserved','payout_paid','payout_released','booking_charge','adjustment','consignment_fee','consignment_fee_reversal'));
alter table public.seller_ledger_entries drop constraint seller_ledger_entries_reference_kind_check;
alter table public.seller_ledger_entries add constraint seller_ledger_entries_reference_kind_check check(reference_kind in
 ('sale_line','sale_return','payout','booking','adjustment','consignment_fee'));
-- Extend only the sign constraint, preserving adjustment/reason constraints.
do $$ declare c record; definition text; begin
 for c in select conname,pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.seller_ledger_entries'::regclass and contype='c' loop
  if c.def like '%credit_sale%' and c.def like '%amount_ore%' then
   definition:=regexp_replace(c.def,'^CHECK \((.*)\)$',E'CHECK (\\1 OR (kind=''consignment_fee'' AND amount_ore<0) OR (kind=''consignment_fee_reversal'' AND amount_ore>0))');
   execute format('alter table public.seller_ledger_entries drop constraint %I',c.conname);
   execute format('alter table public.seller_ledger_entries add constraint %I %s',c.conname,definition);
  end if;
 end loop;
end $$;
alter table public.seller_ledger_entries add constraint ledger_consignment_reference check
 ((kind in ('consignment_fee','consignment_fee_reversal'))=(reference_kind='consignment_fee'));
create unique index ledger_consignment_once on public.seller_ledger_entries(tenant_id,kind,reference_id) where reference_kind='consignment_fee';

create function komisio_private.append_consignment_fee(p_period uuid,p_month integer,p_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.seller_consignment_periods; fee_id uuid; amount numeric; vat numeric; gross numeric;
begin
 select * into strict p from public.seller_consignment_periods where id=p_period;
 fee_id:=md5('consignment-fee:'||p.id::text||':'||p_month::text)::uuid;
 if exists(select 1 from public.consignment_fees where id=fee_id) then return fee_id; end if;
 amount:=(p.fee_terms->>'amountOre')::numeric;
 if p.fee_terms->>'vatBasis'='inclusive' then
  gross:=amount; vat:=round(gross*(p.fee_terms->>'vatRatePercent')::numeric/(100+(p.fee_terms->>'vatRatePercent')::numeric));
 else vat:=round(amount*(p.fee_terms->>'vatRatePercent')::numeric/100); gross:=amount+vat;
 end if;
 insert into public.consignment_fees(id,tenant_id,seller_id,period_id,month_index,starts_at,ends_at,net_ore,vat_ore,gross_ore,collection,currency,recorded_by)
 values(fee_id,p.tenant_id,p.seller_id,p.id,p_month,komisio_private.consignment_month_end(p.started_at,p_month),
  komisio_private.consignment_month_end(p.started_at,p_month+1),gross-vat,vat,gross,p.fee_terms->>'collection',p.currency,p_actor);
 if p.fee_terms->>'collection'='balance' then
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
  values(fee_id,p.tenant_id,p.seller_id,'consignment_fee',-gross,'consignment_fee',fee_id,'Monthly consignment fee',now(),p_actor);
 end if;
 return fee_id;
end $$;
revoke all on function komisio_private.append_consignment_fee(uuid,integer,uuid) from public,anon,authenticated;

create function komisio_private.accrue_consignment_fees(p_period uuid,p_now timestamptz,p_actor uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.seller_consignment_periods; n integer; boundary timestamptz; added integer:=0;
begin
 select * into strict p from public.seller_consignment_periods where id=p_period;
 perform 1 from public.tenants where id=p.tenant_id for update;
 if not exists(select 1 from public.tenant_members where tenant_id=p.tenant_id and user_id=p_actor and role in ('owner','admin','staff')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select coalesce(max(month_index),-1)+1 into n from public.consignment_fees where period_id=p.id;
 for attempt in 1..120 loop
  boundary:=komisio_private.consignment_month_end(p.started_at,n);
  exit when boundary>p_now;
  exit when n>0 and not exists(
   select 1 from public.items i join public.consignment_receipt_periods r on r.tenant_id=i.tenant_id and r.id=(i.terms->'consignmentPeriod'->>'id')::uuid
   where r.billing_period_id=p.id and i.seller_id=p.seller_id and i.accepted_at<=boundary
    and ((r.sale_ends_at at time zone 'Europe/Stockholm')+make_interval(days=>coalesce((select sum((e.detail->>'days')::integer)::integer
     from public.item_events e where e.tenant_id=i.tenant_id and e.item_id=i.id and e.kind='period_extended' and e.occurred_at<=boundary),0))) at time zone 'Europe/Stockholm'>boundary
    and not exists(select 1 from public.item_events e where e.tenant_id=i.tenant_id and e.item_id=i.id and e.kind='period_ended' and e.occurred_at<=boundary)
    and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
     where l.tenant_id=i.tenant_id and l.item_id=i.id and s.status='completed' and s.occurred_at<=boundary
      and not exists(select 1 from public.sale_returns ret where ret.tenant_id=l.tenant_id and ret.sale_line_id=l.id and ret.occurred_at<=boundary))
  );
  perform komisio_private.append_consignment_fee(p.id,n,p_actor); n:=n+1; added:=added+1;
 end loop;
 return added;
end $$;
revoke all on function komisio_private.accrue_consignment_fees(uuid,timestamptz,uuid) from public,anon,authenticated;

create function komisio_private.bind_consignment_billing() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy public.store_policy_versions; p public.seller_consignment_periods; until_at timestamptz;
begin
 select * into strict policy from public.store_policy_versions where tenant_id=new.tenant_id and id=new.policy_id;
 if not coalesce(policy.policy->'consignmentPeriod' ? 'monthlyFee',false) then return new; end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 select * into p from public.seller_consignment_periods where tenant_id=new.tenant_id and seller_id=new.seller_id order by started_at desc,id limit 1;
 if found then
  perform komisio_private.accrue_consignment_fees(p.id,new.received_at,new.recorded_by);
  select max(ends_at) into until_at from public.consignment_fees where period_id=p.id;
 end if;
 if p.id is null or until_at<=new.received_at then
  insert into public.seller_consignment_periods(tenant_id,seller_id,started_at,policy_id,fee_terms,currency,authorized_by,created_by)
  values(new.tenant_id,new.seller_id,new.received_at,policy.id,policy.policy->'consignmentPeriod'->'monthlyFee',
   komisio_private.store_currency(new.tenant_id),policy.created_by,new.recorded_by) returning * into p;
  perform komisio_private.append_consignment_fee(p.id,0,new.recorded_by);
 end if;
 new.billing_period_id:=p.id;
 return new;
end $$;
revoke all on function komisio_private.bind_consignment_billing() from public,anon,authenticated;
create trigger bind_billing before insert on public.consignment_receipt_periods for each row execute function komisio_private.bind_consignment_billing();

create function public.record_consignment_fee_payment(p_tenant uuid,p_id uuid,p_fee uuid,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); fee public.consignment_fees; prior public.consignment_fee_events; ref text:=trim(coalesce(p_reference,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_fee is null or length(ref) not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.consignment_fee_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.fee_id is distinct from p_fee or prior.kind<>'paid' or prior.actor<>uid or prior.reference<>ref then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into fee from public.consignment_fees where tenant_id=p_tenant and id=p_fee;
 if not found then raise exception 'FEE_NOT_FOUND'; end if;
 if fee.collection<>'separate' or exists(select 1 from public.consignment_fee_events where fee_id=p_fee) then raise exception 'FEE_DECIDED'; end if;
 insert into public.consignment_fee_events(id,tenant_id,fee_id,kind,reference,actor) values(p_id,p_tenant,p_fee,'paid',ref,uid);
 perform komisio_private.record_access(p_tenant,'consignment_fee.paid',p_fee,jsonb_build_object('eventId',p_id));
 return p_id;
end $$;

create function public.reverse_consignment_fee(p_tenant uuid,p_id uuid,p_fee uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); fee public.consignment_fees; prior public.consignment_fee_events; note text:=trim(coalesce(p_reason,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_fee is null or length(note) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.consignment_fee_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.fee_id is distinct from p_fee or prior.kind<>'reversed' or prior.actor<>uid or prior.reason<>note then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into fee from public.consignment_fees where tenant_id=p_tenant and id=p_fee;
 if not found then raise exception 'FEE_NOT_FOUND'; end if;
 -- Paid external receipts need their own external credit/refund evidence; never invent it.
 if exists(select 1 from public.consignment_fee_events where fee_id=p_fee) then raise exception 'FEE_DECIDED'; end if;
 insert into public.consignment_fee_events(id,tenant_id,fee_id,kind,reason,actor) values(p_id,p_tenant,p_fee,'reversed',note,uid);
 if fee.collection='balance' then
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
  values(p_id,p_tenant,fee.seller_id,'consignment_fee_reversal',fee.gross_ore,'consignment_fee',fee.id,note,now(),uid);
 end if;
 perform komisio_private.record_access(p_tenant,'consignment_fee.reversed',p_fee,jsonb_build_object('eventId',p_id));
 return p_id;
end $$;

create function public.accrue_seller_consignment_fees(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); p record; n integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 for p in select id from public.seller_consignment_periods where tenant_id=p_tenant and seller_id=p_seller order by started_at,id loop
  n:=n+komisio_private.accrue_consignment_fees(p.id,now(),uid);
 end loop;
 return jsonb_build_object('sellerId',p_seller,'added',n);
end $$;

create function komisio_private.seller_consignment_fee_rows(p_tenant uuid,p_seller uuid,p_offset integer) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('total',(select count(*) from public.consignment_fees where tenant_id=p_tenant and seller_id=p_seller),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id) from (
  select f.*,case when exists(select 1 from public.consignment_fee_events e where e.fee_id=f.id and e.kind='reversed') then 'reversed'
   when f.collection='balance' then 'deducted' when exists(select 1 from public.consignment_fee_events e where e.fee_id=f.id and e.kind='paid') then 'paid' else 'unpaid' end as status,
   (select reference from public.consignment_fee_events e where e.fee_id=f.id and e.kind='paid') as payment_reference,
   (select reason from public.consignment_fee_events e where e.fee_id=f.id and e.kind='reversed') as correction_reason
  from public.consignment_fees f where f.tenant_id=p_tenant and f.seller_id=p_seller order by f.starts_at desc,f.id limit 25 offset p_offset
 ) x),'[]'::jsonb))
$$;
revoke all on function komisio_private.seller_consignment_fee_rows(uuid,uuid,integer) from public,anon,authenticated;
create function public.seller_consignment_fees(p_tenant uuid,p_seller uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 then raise exception 'INVALID_INPUT'; end if;
 return komisio_private.seller_consignment_fee_rows(p_tenant,p_seller,p_offset);
end $$;
create function public.my_consignment_fees(p_tenant uuid,p_seller uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 if p_offset is null or p_offset<0 then raise exception 'INVALID_INPUT'; end if;
 -- Do not expose internal actor IDs, staff payment references or correction notes to sellers.
 return jsonb_set(komisio_private.seller_consignment_fee_rows(p_tenant,p_seller,p_offset),'{rows}',
  (select coalesce(jsonb_agg(r-array['recorded_by','payment_reference','correction_reason']),'[]'::jsonb)
   from jsonb_array_elements(komisio_private.seller_consignment_fee_rows(p_tenant,p_seller,p_offset)->'rows') r));
end $$;
revoke all on function public.record_consignment_fee_payment(uuid,uuid,uuid,text),public.reverse_consignment_fee(uuid,uuid,uuid,text),
 public.accrue_seller_consignment_fees(uuid,uuid),public.seller_consignment_fees(uuid,uuid,integer),public.my_consignment_fees(uuid,uuid,integer) from public,anon;
grant execute on function public.record_consignment_fee_payment(uuid,uuid,uuid,text),public.reverse_consignment_fee(uuid,uuid,uuid,text),
 public.accrue_seller_consignment_fees(uuid,uuid),public.seller_consignment_fees(uuid,uuid,integer),public.my_consignment_fees(uuid,uuid,integer) to authenticated;

create function komisio_private.run_automatic_consignment_fees() returns integer
language plpgsql security definer set search_path='' as $$
declare p record; n integer:=0;
begin
 for p in select s.* from public.seller_consignment_periods s
  join public.tenant_members m on m.tenant_id=s.tenant_id and m.user_id=s.authorized_by and m.role in ('owner','admin')
  order by s.tenant_id,s.started_at,s.id loop
  n:=n+komisio_private.accrue_consignment_fees(p.id,now(),p.authorized_by);
 end loop;
 return n;
end $$;
revoke all on function komisio_private.run_automatic_consignment_fees() from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('komisio-consignment-fees','7 * * * *','select komisio_private.run_automatic_consignment_fees()');
 end if;
end $$;

create function komisio_private.freeze_fee_currency() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.consignment_fees where tenant_id=new.tenant_id and currency<>coalesce(new.policy->>'currency','SEK')) then raise exception 'CURRENCY_FROZEN'; end if;
 return new;
end $$;
revoke all on function komisio_private.freeze_fee_currency() from public,anon,authenticated;
create trigger freeze_fee_currency before insert on public.store_policy_versions for each row execute function komisio_private.freeze_fee_currency();
