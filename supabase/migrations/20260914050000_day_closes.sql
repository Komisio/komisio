-- P2 S17: the day close as a versioned fact. Totals for one local day
-- (Europe/Stockholm) derived from completed sales, returns and paid payouts,
-- with VAT per mode so a tenant's mode change is visible in the books.
-- Regenerating an unchanged day returns the existing version; a changed day
-- gets a new version. Nothing is edited. The accounting export (Fortnox) is
-- a separate fact prepared from a day close with the tenant's account map.
create table public.day_closes (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 close_date date not null,
 version integer not null check(version>0),
 sales_count integer not null default 0,
 returns_count integer not null default 0,
 gross_ore bigint not null default 0,
 vat_ore bigint not null default 0,
 commission_ore bigint not null default 0,
 commission_vat_ore bigint not null default 0,
 seller_credit_ore bigint not null default 0,
 refunds_ore bigint not null default 0,
 credit_reversed_ore bigint not null default 0,
 payouts_paid_ore bigint not null default 0,
 per_mode jsonb not null default '{}'::jsonb check(jsonb_typeof(per_mode)='object'),
 generated_by uuid not null references auth.users(id),
 generated_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,close_date,version)
);
create index day_closes_tenant on public.day_closes(tenant_id,close_date desc,version desc);
alter table public.day_closes enable row level security;
create policy day_closes_read on public.day_closes for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.day_closes from public,anon,authenticated;
grant select on public.day_closes to authenticated;
create function komisio_private.preserve_day_close() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_DAY_CLOSE' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_day_close() from public,anon,authenticated;
create trigger day_closes_immutable before update or delete on public.day_closes for each row execute function komisio_private.preserve_day_close();

-- Pure computation of one local day's totals. Not exposed; the generate function and tests use it.
create function komisio_private.day_close_totals(p_tenant uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day_start timestamptz:=(p_date::text||' 00:00')::timestamp at time zone 'Europe/Stockholm'; day_end timestamptz:=((p_date+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 t record; modes jsonb;
begin
 select count(distinct l.sale_id)::int as sales_count,coalesce(sum(l.price_ore),0)::bigint as gross,coalesce(sum(l.vat_ore),0)::bigint as vat,
  coalesce(sum(l.commission_ore),0)::bigint as commission,coalesce(sum(l.commission_vat_ore),0)::bigint as commission_vat,coalesce(sum(l.seller_credit_ore),0)::bigint as credit
 into t from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
 where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=day_start and s.occurred_at<day_end;
 select coalesce(jsonb_object_agg(m.vat_mode,jsonb_build_object('lines',m.n,'grossOre',m.gross,'vatOre',m.vat,'netOre',m.gross-m.vat)),'{}'::jsonb) into modes
 from (select l.vat_mode,count(*)::int n,sum(l.price_ore)::bigint gross,sum(l.vat_ore)::bigint vat
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=day_start and s.occurred_at<day_end group by l.vat_mode) m;
 return jsonb_build_object(
  'salesCount',t.sales_count,'grossOre',t.gross,'vatOre',t.vat,'commissionOre',t.commission,'commissionVatOre',t.commission_vat,'sellerCreditOre',t.credit,
  'returnsCount',(select count(*)::int from public.sale_returns r where r.tenant_id=p_tenant and r.occurred_at>=day_start and r.occurred_at<day_end),
  'refundsOre',(select coalesce(sum(r.refund_ore),0)::bigint from public.sale_returns r where r.tenant_id=p_tenant and r.occurred_at>=day_start and r.occurred_at<day_end),
  'creditReversedOre',(select coalesce(-sum(e.amount_ore),0)::bigint from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.kind='credit_reversal' and e.occurred_at>=day_start and e.occurred_at<day_end),
  'payoutsPaidOre',(select coalesce(sum(p.amount_ore),0)::bigint from public.payouts p where p.tenant_id=p_tenant and p.status='paid' and p.paid_at>=day_start and p.paid_at<day_end),
  'perMode',modes);
end $$;
revoke all on function komisio_private.day_close_totals(uuid,date) from public,anon,authenticated;

create function public.generate_day_close(p_tenant uuid,p_id uuid,p_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.day_closes; latest public.day_closes; totals jsonb; same boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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
