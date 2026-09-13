-- P2 S16: the numbered settlement statement. A statement is computed from the
-- seller ledger for a period and frozen: number from a per-tenant sequence,
-- opening balance, the period's entries as lines, closing balance. Immutable;
-- a correction is a new statement of kind credit_note that references the
-- original. Rendering and delivery come with S18; this is the fact.
create table public.settlement_statements (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 number integer not null check(number>0),
 kind text not null default 'statement' check(kind in ('statement','credit_note')),
 corrects_id uuid,
 period_from timestamptz not null,
 period_to timestamptz not null,
 opening_ore bigint not null,
 sales_gross_ore bigint not null default 0,
 commission_ore bigint not null default 0,
 credited_ore bigint not null default 0,
 reversed_ore bigint not null default 0,
 paid_ore bigint not null default 0,
 adjustments_ore bigint not null default 0,
 closing_ore bigint not null,
 issued_by uuid not null references auth.users(id),
 issued_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,number),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,corrects_id) references public.settlement_statements(tenant_id,id),
 check(period_to>period_from),
 check((kind='credit_note')=(corrects_id is not null))
);
create index settlement_statements_seller on public.settlement_statements(tenant_id,seller_id,number desc);
create table public.settlement_statement_lines (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 statement_id uuid not null,
 line_no integer not null check(line_no>0),
 ledger_entry_id uuid not null,
 kind text not null,
 amount_ore bigint not null,
 occurred_at timestamptz not null,
 reference_kind text not null,
 reference_id uuid not null,
 sale_price_ore bigint,
 commission_ore bigint,
 foreign key(tenant_id,statement_id) references public.settlement_statements(tenant_id,id),
 foreign key(tenant_id,ledger_entry_id) references public.seller_ledger_entries(tenant_id,id),
 unique(tenant_id,statement_id,line_no)
);
create index settlement_lines_statement on public.settlement_statement_lines(tenant_id,statement_id,line_no);
alter table public.settlement_statements enable row level security;
alter table public.settlement_statement_lines enable row level security;
create policy settlement_statements_read on public.settlement_statements for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy settlement_lines_read on public.settlement_statement_lines for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.settlement_statements,public.settlement_statement_lines from public,anon,authenticated;
grant select on public.settlement_statements,public.settlement_statement_lines to authenticated;
create function komisio_private.preserve_statement() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_STATEMENT' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_statement() from public,anon,authenticated;
create trigger settlement_statements_immutable before update or delete on public.settlement_statements for each row execute function komisio_private.preserve_statement();
create trigger settlement_lines_immutable before update or delete on public.settlement_statement_lines for each row execute function komisio_private.preserve_statement();

-- Numbers come from a per-tenant counter row locked in the tenant transaction.
create table public.statement_counters (
 tenant_id uuid primary key references public.tenants(id),
 last_number integer not null default 0
);
alter table public.statement_counters enable row level security;
revoke all on public.statement_counters from public,anon,authenticated;

create function public.issue_statement(p_tenant uuid,p_id uuid,p_seller uuid,p_from timestamptz,p_to timestamptz,p_corrects uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.settlement_statements; original public.settlement_statements; n integer; opening bigint; closing bigint; entry record; i integer:=0;
 gross bigint:=0; commission bigint:=0; credited bigint:=0; reversed bigint:=0; paid bigint:=0; adjustments bigint:=0; line_price bigint; line_commission bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.settlement_statements where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.period_from is distinct from p_from or prior.period_to is distinct from p_to
   or prior.corrects_id is distinct from p_corrects or prior.issued_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_corrects is not null then
  select * into original from public.settlement_statements where tenant_id=p_tenant and id=p_corrects;
  if not found or original.seller_id<>p_seller then raise exception 'STATEMENT_NOT_FOUND'; end if;
  if exists(select 1 from public.settlement_statements where tenant_id=p_tenant and corrects_id=p_corrects) then raise exception 'STATEMENT_ALREADY_CORRECTED'; end if;
 elsif exists(select 1 from public.settlement_statements s where s.tenant_id=p_tenant and s.seller_id=p_seller and s.kind='statement'
   and not exists(select 1 from public.settlement_statements c where c.tenant_id=p_tenant and c.corrects_id=s.id)
   and s.period_from<p_to and s.period_to>p_from) then raise exception 'STATEMENT_PERIOD_OVERLAP'; end if;
 insert into public.statement_counters(tenant_id) values(p_tenant) on conflict(tenant_id) do nothing;
 update public.statement_counters set last_number=last_number+1 where tenant_id=p_tenant returning last_number into n;
 select coalesce(sum(amount_ore),0) into opening from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller and occurred_at<p_from;
 closing:=opening;
 insert into public.settlement_statements(id,tenant_id,seller_id,number,kind,corrects_id,period_from,period_to,opening_ore,closing_ore,issued_by)
 values(p_id,p_tenant,p_seller,n,case when p_corrects is null then 'statement' else 'credit_note' end,p_corrects,p_from,p_to,opening,opening,uid);
 for entry in select e.*,l.price_ore as sale_price,l.commission_ore+l.commission_vat_ore as sale_commission
  from public.seller_ledger_entries e left join public.sale_lines l on e.reference_kind='sale_line' and l.tenant_id=e.tenant_id and l.id=e.reference_id
  where e.tenant_id=p_tenant and e.seller_id=p_seller and e.occurred_at>=p_from and e.occurred_at<p_to order by e.occurred_at,e.id loop
  i:=i+1; closing:=closing+entry.amount_ore;
  case entry.kind
   when 'credit_sale' then credited:=credited+entry.amount_ore; gross:=gross+coalesce(entry.sale_price,0); commission:=commission+coalesce(entry.sale_commission,0);
   when 'credit_reversal' then reversed:=reversed-entry.amount_ore;
   when 'payout_paid' then paid:=paid-entry.amount_ore;
   when 'adjustment' then adjustments:=adjustments+entry.amount_ore;
   else null;
  end case;
  insert into public.settlement_statement_lines(tenant_id,statement_id,line_no,ledger_entry_id,kind,amount_ore,occurred_at,reference_kind,reference_id,sale_price_ore,commission_ore)
  values(p_tenant,p_id,i,entry.id,entry.kind,entry.amount_ore,entry.occurred_at,entry.reference_kind,entry.reference_id,entry.sale_price,entry.sale_commission);
 end loop;
 -- The header totals are written once the lines are known; the trigger allows nothing after this.
 perform set_config('komisio.statement_issue','engine',true);
 update public.settlement_statements set sales_gross_ore=gross,commission_ore=commission,credited_ore=credited,reversed_ore=reversed,paid_ore=paid,adjustments_ore=adjustments,closing_ore=closing where id=p_id;
 perform set_config('komisio.statement_issue','',true);
 perform komisio_private.record_access(p_tenant,'statement.issued',p_id,jsonb_build_object('seller_id',p_seller,'number',n,'kind',case when p_corrects is null then 'statement' else 'credit_note' end));
 return p_id;
end $$;
-- Allow exactly the in-transaction total write above; every other update or delete is refused.
create or replace function komisio_private.preserve_statement() returns trigger
language plpgsql set search_path='' as $$
begin
 -- Evaluation order of AND is not guaranteed, so the table check must be its own branch.
 if tg_table_name='settlement_statements' and tg_op='UPDATE' then
  if current_setting('komisio.statement_issue',true)='engine' and new.id=old.id and new.number=old.number and new.seller_id=old.seller_id
   and new.period_from=old.period_from and new.period_to=old.period_to and new.opening_ore=old.opening_ore then return new; end if;
 end if;
 raise exception 'IMMUTABLE_STATEMENT' using errcode='55000';
end $$;
revoke all on function public.issue_statement(uuid,uuid,uuid,timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.issue_statement(uuid,uuid,uuid,timestamptz,timestamptz,uuid) to authenticated;
