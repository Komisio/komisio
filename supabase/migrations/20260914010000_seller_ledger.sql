-- P2 S14: the append-only seller ledger every seller-facing number derives from.
-- Written only by engine functions. Amounts are signed öre against the seller's
-- available balance: credits positive, reversals negative, reservations negative
-- and their release positive, payments negative, adjustments either. The balance
-- is a sum, never a stored column.
create table public.seller_ledger_entries (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 kind text not null check(kind in ('credit_sale','credit_reversal','payout_reserved','payout_paid','payout_released','booking_charge','adjustment')),
 amount_ore bigint not null check(amount_ore<>0 and abs(amount_ore)<=99999999999),
 reference_kind text not null check(reference_kind in ('sale_line','sale_return','payout','booking','adjustment')),
 reference_id uuid not null,
 reason text not null default '' check(length(reason)<=500),
 occurred_at timestamptz not null,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 check((kind='credit_sale' and amount_ore>0) or (kind='credit_reversal' and amount_ore<0) or (kind='payout_reserved' and amount_ore<0)
  or (kind='payout_released' and amount_ore>0) or (kind='payout_paid' and amount_ore<0) or (kind='booking_charge' and amount_ore<0) or kind='adjustment'),
 check((kind='adjustment')=(reference_kind='adjustment')),
 check(kind<>'adjustment' or length(trim(reason))>0)
);
create index seller_ledger_seller on public.seller_ledger_entries(tenant_id,seller_id,occurred_at,id);
create unique index seller_ledger_one_credit_per_line on public.seller_ledger_entries(tenant_id,reference_id) where kind='credit_sale';
alter table public.seller_ledger_entries enable row level security;
create policy seller_ledger_read on public.seller_ledger_entries for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.seller_ledger_entries from public,anon,authenticated;
grant select on public.seller_ledger_entries to authenticated;
create function komisio_private.preserve_ledger() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_LEDGER' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_ledger() from public,anon,authenticated;
create trigger seller_ledger_immutable before update or delete on public.seller_ledger_entries for each row execute function komisio_private.preserve_ledger();

-- Available and reserved balances as sums; reserved is what approved payouts hold.
create function public.seller_balance(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare available bigint; reserved bigint; credited bigint; paid bigint; entries integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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

-- Owner or admin correction with a reason; every entry is a new fact.
create function public.adjust_seller_ledger(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_ledger_entries; note text:=trim(coalesce(p_reason,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_amount_ore is null or p_amount_ore=0 or abs(p_amount_ore)>99999999999 or length(note) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.seller_ledger_entries where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind<>'adjustment' or prior.amount_ore is distinct from p_amount_ore
   or prior.reason is distinct from note or prior.recorded_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
 values(p_id,p_tenant,p_seller,'adjustment',p_amount_ore,'adjustment',p_id,note,now(),uid);
 perform komisio_private.record_access(p_tenant,'seller_ledger.adjusted',p_id,jsonb_build_object('seller_id',p_seller,'amount_ore',p_amount_ore));
 return p_id;
end $$;
revoke all on function public.seller_balance(uuid,uuid),public.adjust_seller_ledger(uuid,uuid,uuid,bigint,text) from public,anon;
grant execute on function public.seller_balance(uuid,uuid),public.adjust_seller_ledger(uuid,uuid,uuid,bigint,text) to authenticated;

-- record_sale re-declared: consignment lines credit the seller's ledger.
create or replace function public.record_sale(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sales; pol jsonb; line jsonb; facts jsonb; computed jsonb:='[]'::jsonb; total bigint:=0; n integer:=0; ext text:=trim(p_external_id); existing_lines jsonb; line_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_provider is null or p_provider not in ('manual','zettle','shopify') or ext is null or length(ext) not between 1 and 200
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' or p_currency is distinct from 'SEK'
  or p_reference is null or jsonb_typeof(p_reference)<>'object' or not komisio_private.valid_sale_lines(p_lines) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.sales where id=p_id;
 if not found then select * into prior from public.sales where tenant_id=p_tenant and provider=p_provider and external_id=ext; end if;
 if prior.id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('itemId',l.item_id,'priceOre',l.price_ore) order by l.line_no),'[]'::jsonb) into existing_lines from public.sale_lines l where l.tenant_id=prior.tenant_id and l.sale_id=prior.id;
  if prior.tenant_id is distinct from p_tenant or prior.provider is distinct from p_provider or prior.external_id is distinct from ext
   or prior.occurred_at is distinct from p_occurred_at or existing_lines is distinct from p_lines then
   raise exception 'SALE_CONFLICT';
  end if;
  return prior.id;
 end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 for line in select * from jsonb_array_elements(p_lines) loop
  n:=n+1;
  facts:=komisio_private.sale_line_facts(p_tenant,(line->>'itemId')::uuid,(line->>'priceOre')::bigint,pol);
  computed:=computed||(facts||jsonb_build_object('lineNo',n));
  total:=total+(facts->>'priceOre')::bigint;
 end loop;
 insert into public.sales(id,tenant_id,provider,external_id,currency,occurred_at,total_ore,provider_reference,recorded_by)
 values(p_id,p_tenant,p_provider,ext,'SEK',p_occurred_at,total,p_reference,uid);
 for facts in select * from jsonb_array_elements(computed) loop
  insert into public.sale_lines(tenant_id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,
   vat_mode,vat_rate_bp,vat_basis,vat_ore,agreement_version_id,seller_terms_version,store_policy_version)
  values(p_tenant,p_id,(facts->>'itemId')::uuid,(facts->>'lineNo')::integer,(facts->>'priceOre')::bigint,facts->>'ownership',facts->>'commissionBasis',(facts->>'commissionRatePercent')::numeric,
   (facts->>'commissionOre')::bigint,(facts->>'commissionVatOre')::bigint,(facts->>'sellerCreditOre')::bigint,
   facts->>'vatMode',(facts->>'vatRateBp')::integer,facts->'vatBasis',(facts->>'vatOre')::bigint,(facts->>'agreementVersionId')::uuid,(facts->>'sellerTermsVersion')::integer,(facts->>'storePolicyVersion')::integer)
  returning id into line_id;
  insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,(facts->>'itemId')::uuid,'sold',jsonb_build_object('saleId',p_id,'lineNo',(facts->>'lineNo')::integer,'priceOre',(facts->>'priceOre')::bigint,'provider',p_provider),uid);
  -- S14: the seller's share becomes a ledger credit the moment the sale is a fact.
  if facts->>'ownership'='consignment' and (facts->>'sellerCreditOre')::bigint>0 then
   insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
   values(gen_random_uuid(),p_tenant,(facts->>'sellerId')::uuid,'credit_sale',(facts->>'sellerCreditOre')::bigint,'sale_line',line_id,p_occurred_at,uid);
  end if;
 end loop;
 perform komisio_private.record_access(p_tenant,'sale.recorded',p_id,jsonb_build_object('provider',p_provider,'external_id',ext,'lines',n,'total_ore',total));
 return p_id;
end $$;
