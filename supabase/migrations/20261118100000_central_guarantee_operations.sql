-- Business fulfillment is independent of the still-undecided accounting model.
-- Existing snapshots remain immutable; no purchase tax evidence is invented.
alter table public.sale_lines
 add column guarantee_id uuid,
 add column accounting_pending boolean not null default false,
 add foreign key(tenant_id,guarantee_id) references public.external_item_guarantees(tenant_id,id),
 alter column commission_ore drop not null,
 alter column commission_vat_ore drop not null,
 alter column vat_mode drop not null,
 alter column vat_rate_bp drop not null,
 alter column vat_ore drop not null,
 drop constraint sale_lines_check;
alter table public.sale_lines add constraint sale_lines_accounting_shape check (
 case when accounting_pending then guarantee_id is not null and commission_basis is null and commission_rate_percent is null
  and commission_ore is null and commission_vat_ore is null and vat_mode is null and vat_rate_bp is null and vat_ore is null
 else guarantee_id is null and commission_ore is not null and commission_vat_ore is not null and vat_mode is not null
  and vat_rate_bp is not null and vat_ore is not null and ((ownership='store')=(commission_basis is null)) end);

alter table public.seller_ledger_entries drop constraint seller_ledger_entries_kind_check;
alter table public.seller_ledger_entries add constraint seller_ledger_entries_kind_check check(kind in
 ('credit_sale','credit_guarantee','credit_reversal','payout_reserved','payout_paid','payout_released','booking_charge','adjustment','consignment_fee','consignment_fee_reversal'));
alter table public.seller_ledger_entries drop constraint seller_ledger_entries_reference_kind_check;
alter table public.seller_ledger_entries add constraint seller_ledger_entries_reference_kind_check check(reference_kind in
 ('sale_line','external_guarantee','sale_return','payout','booking','adjustment','consignment_fee'));
alter table public.seller_ledger_entries drop constraint seller_ledger_entries_check;
alter table public.seller_ledger_entries add constraint seller_ledger_entries_check check(
 (kind in ('credit_sale','credit_guarantee','payout_released','consignment_fee_reversal') and amount_ore>0)
 or (kind in ('credit_reversal','payout_reserved','payout_paid','booking_charge','consignment_fee') and amount_ore<0) or kind='adjustment');
alter table public.seller_ledger_entries add constraint ledger_guarantee_reference check((kind='credit_guarantee')=(reference_kind='external_guarantee'));
create unique index seller_ledger_one_guarantee on public.seller_ledger_entries(tenant_id,reference_id) where kind='credit_guarantee';

alter table public.external_item_guarantee_events
 alter column item_id drop not null,
 add column effective_at timestamptz check(effective_at is null or isfinite(effective_at)),
 add column reconciliation_required boolean not null default false,
 drop constraint external_item_guarantee_events_check;
alter table public.external_item_guarantee_events add constraint external_item_guarantee_events_check check(case kind
 when 'registered' then item_id is not null and sale_line_id is null and purchase_id is null and ledger_id is null and return_id is null
 when 'sold' then item_id is not null and sale_line_id is not null and purchase_id is null and ledger_id is null and return_id is null
 when 'acquired' then (purchase_id is not null or effective_at is not null) and sale_line_id is null and ledger_id is null and return_id is null
 when 'credited' then ledger_id is not null and return_id is null and not(sale_line_id is not null and purchase_id is not null)
 when 'returned' then item_id is not null and return_id is not null and sale_line_id is not null and purchase_id is null and ledger_id is null
 else false end);
alter table public.external_item_guarantee_events add constraint guarantee_reconciliation_shape check(not reconciliation_required or kind='sold');

create function komisio_private.central_guarantee(p_tenant uuid,p_guarantee uuid) returns public.external_item_guarantees
language plpgsql stable security definer set search_path='' as $$
declare g public.external_item_guarantees;
begin
 if not exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant)
 then raise exception 'GUARANTEED_SALE_REQUIRED'; end if;
 select * into g from public.external_item_guarantees where tenant_id=p_tenant and id=p_guarantee;
 if g.id is null then raise exception 'GUARANTEE_EVIDENCE_REQUIRED'; end if;
 return g;
end $$;

create function komisio_private.item_operational_ownership(p_tenant uuid,p_item uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.external_item_guarantee_events r
  join public.external_item_guarantee_events e on e.guarantee_id=r.guarantee_id and e.tenant_id=r.tenant_id
  where r.tenant_id=i.tenant_id and r.item_id=i.id and r.kind='registered' and e.kind in ('acquired','returned'))
 then 'store' else i.ownership end from public.items i where i.tenant_id=p_tenant and i.id=p_item;
$$;

create function komisio_private.guaranteed_sale_facts(p_tenant uuid,p_item uuid,p_price bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.items; g public.external_item_guarantees; credit bigint; ownership text;
begin
 select * into i from public.items where tenant_id=p_tenant and id=p_item;
 g:=komisio_private.central_guarantee(p_tenant,(i.terms#>>'{externalGuarantee,id}')::uuid);
 if not exists(select 1 from public.external_item_guarantee_events where tenant_id=p_tenant and guarantee_id=g.id and item_id=i.id and kind='registered')
  or i.seller_id is distinct from g.seller_id then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 credit:=case when exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='credited') then 0 else g.amount_ore end;
 ownership:=komisio_private.item_operational_ownership(p_tenant,p_item);
 return jsonb_build_object('itemId',i.id,'priceOre',p_price,'ownership',ownership,'sellerId',g.seller_id,
  'guaranteeId',g.id,'accountingPending',true,'commissionBasis',null,'commissionRatePercent',null,
  'commissionOre',null,'commissionVatOre',null,'sellerCreditOre',credit,'vatMode',null,'vatRateBp',null,'vatOre',null,
  'vatBasis',jsonb_build_object('accountingPending',true,'guaranteeId',g.id,'fixedAmountOre',g.amount_ore::text),
  'agreementVersionId',i.terms->'agreementVersionId','sellerTermsVersion',null,'storePolicyVersion',i.terms->'storePolicyVersion');
end $$;

create function komisio_private.validate_pending_guarantee_sale() returns trigger
language plpgsql set search_path='' as $$
declare g public.external_item_guarantees;
begin
 if new.accounting_pending then
  g:=komisio_private.central_guarantee(new.tenant_id,new.guarantee_id);
  if not exists(select 1 from public.items i join public.external_item_guarantee_events e on e.tenant_id=i.tenant_id and e.item_id=i.id and e.kind='registered'
   where i.tenant_id=g.tenant_id and i.id=new.item_id and i.seller_id=g.seller_id and e.guarantee_id=g.id
    and i.terms#>>'{externalGuarantee,id}'=g.id::text)
  then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
  if new.seller_credit_ore not in (0,g.amount_ore) then raise exception 'GUARANTEE_CREDIT_MISMATCH'; end if;
  if exists(select 1 from public.sales s where s.tenant_id=g.tenant_id and s.id=new.sale_id
   and (s.currency<>g.currency or s.occurred_at<g.received_at or s.occurred_at>clock_timestamp()))
  then raise exception 'INVALID_INPUT'; end if;
 end if;
 return new;
end $$;
create trigger pending_guarantee_evidence before insert on public.sale_lines for each row execute function komisio_private.validate_pending_guarantee_sale();

-- Extend the existing evidence validator, preserving legacy fulfillment links.
create or replace function komisio_private.validate_external_guarantee_event() returns trigger
language plpgsql set search_path='' as $$
declare g public.external_item_guarantees; registration uuid;
begin
 select * into g from public.external_item_guarantees where tenant_id=new.tenant_id and id=new.guarantee_id;
 if g.id is null then raise exception 'GUARANTEE_EVIDENCE_REQUIRED'; end if;
 if new.kind='registered' then
  if not exists(select 1 from public.items i where i.tenant_id=g.tenant_id and i.id=new.item_id and i.seller_id=g.seller_id
   and (i.custody_kind='bag' and i.custody_id=g.bag_id or i.custody_kind='garment' and exists(
    select 1 from public.garment_receipts r join public.reception_sessions s on s.tenant_id=r.tenant_id and s.id=r.session_id
    where r.tenant_id=g.tenant_id and r.id=i.custody_id and s.bag_id=g.bag_id))) then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 else
  select item_id into registration from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered';
  if registration is distinct from new.item_id then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 end if;
 if new.sale_line_id is not null and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=g.tenant_id and l.id=new.sale_line_id and l.item_id=new.item_id and s.status='completed') then raise exception 'GUARANTEE_SALE_MISMATCH'; end if;
 if new.purchase_id is not null and not exists(select 1 from public.purchase_receipts p where p.tenant_id=g.tenant_id and p.id=new.purchase_id
  and p.purchase_price_ore=g.amount_ore and p.currency=g.currency) then raise exception 'GUARANTEE_PURCHASE_MISMATCH'; end if;
 if new.kind='acquired' and new.purchase_id is null and new.effective_at is distinct from g.due_at then raise exception 'GUARANTEE_DEADLINE_MISMATCH'; end if;
 if new.ledger_id is not null and not exists(select 1 from public.seller_ledger_entries l where l.tenant_id=g.tenant_id and l.id=new.ledger_id
  and l.seller_id=g.seller_id and l.amount_ore=g.amount_ore and (
   l.kind='credit_guarantee' and l.reference_kind='external_guarantee' and l.reference_id=g.id and l.occurred_at=new.effective_at
   or l.reference_id=coalesce(new.sale_line_id,new.purchase_id) and l.reference_kind=case when new.sale_line_id is not null then 'sale_line' else 'purchase_receipt' end))
 then raise exception 'GUARANTEE_CREDIT_MISMATCH'; end if;
 if new.return_id is not null and not exists(select 1 from public.sale_returns r where r.tenant_id=g.tenant_id and r.id=new.return_id
  and r.item_id=new.item_id and r.sale_line_id=new.sale_line_id) then raise exception 'GUARANTEE_RETURN_MISMATCH'; end if;
 return new;
end $$;

create function komisio_private.credit_central_guarantee(p_tenant uuid,p_guarantee uuid,p_sale_line uuid,p_effective timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare g public.external_item_guarantees; uid uuid:=komisio_private.require_identity(); iid uuid; lid uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 g:=komisio_private.central_guarantee(p_tenant,p_guarantee);
 if exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='credited') then return false; end if;
 if p_effective is null or not isfinite(p_effective) or p_effective<g.received_at or p_effective>g.due_at then raise exception 'INVALID_INPUT'; end if;
 select item_id into iid from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered';
 lid:=komisio_private.derived_id(g.id::text||':fixed-credit');
 insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
 values(lid,g.tenant_id,g.seller_id,'credit_guarantee',g.amount_ore,'external_guarantee',g.id,p_effective,uid);
 insert into public.external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,ledger_id,recorded_by,effective_at)
 values(komisio_private.derived_id(g.id::text||':credited'),g.tenant_id,g.id,'credited',iid,p_sale_line,lid,uid,p_effective);
 perform komisio_private.record_access(p_tenant,'external_item.guarantee_credited',g.id,jsonb_build_object('ledgerId',lid,'amountOre',g.amount_ore::text));
 return true;
end $$;

create function komisio_private.record_guaranteed_sale(p_tenant uuid,p_line uuid) returns void
language plpgsql security definer set search_path='' as $$
declare l public.sale_lines; s public.sales; g public.external_item_guarantees;
begin
 select * into l from public.sale_lines where tenant_id=p_tenant and id=p_line;
 g:=komisio_private.central_guarantee(p_tenant,l.guarantee_id);
 select * into s from public.sales where tenant_id=p_tenant and id=l.sale_id;
 insert into public.external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,recorded_by,effective_at,reconciliation_required)
 values(komisio_private.derived_id(l.id::text||':guaranteed-sale'),p_tenant,g.id,'sold',l.item_id,l.id,s.recorded_by,s.occurred_at,
  s.occurred_at<g.due_at and exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='acquired'));
 perform komisio_private.credit_central_guarantee(p_tenant,g.id,l.id,least(s.occurred_at,g.due_at));
end $$;

create function komisio_private.fulfill_due_guarantee(p_tenant uuid,p_guarantee uuid,p_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare g public.external_item_guarantees; iid uuid; uid uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 g:=komisio_private.central_guarantee(p_tenant,p_guarantee);
 if g.due_at>p_at or exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='credited') then return false; end if;
 select item_id into iid from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered';
 if exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='sold') then raise exception 'GUARANTEE_RECONCILIATION_REQUIRED'; end if;
 insert into public.external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,recorded_by,effective_at)
 values(komisio_private.derived_id(g.id::text||':acquired'),p_tenant,g.id,'acquired',iid,uid,g.due_at);
 perform komisio_private.credit_central_guarantee(p_tenant,g.id,null,g.due_at);
 perform komisio_private.record_access(p_tenant,'external_item.guarantee_acquired',g.id,jsonb_build_object('effectiveAt',g.due_at,'accountingPending',true));
 return true;
end $$;

revoke all on function komisio_private.central_guarantee(uuid,uuid),komisio_private.item_operational_ownership(uuid,uuid),
 komisio_private.guaranteed_sale_facts(uuid,uuid,bigint),komisio_private.validate_pending_guarantee_sale(),
 komisio_private.credit_central_guarantee(uuid,uuid,uuid,timestamptz),komisio_private.record_guaranteed_sale(uuid,uuid),
 komisio_private.fulfill_due_guarantee(uuid,uuid,timestamptz) from public,anon,authenticated;

do $$ declare d text; needle text; begin
 d:=replace(pg_get_functiondef('komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)'::regprocedure),E'\r','');
 needle:='if item.terms ? ''externalGuarantee'' then raise exception ''GUARANTEED_SALE_REQUIRED''; end if;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_GUARANTEE_SALE_GUARD'; end if;
 execute replace(d,needle,'if item.terms ? ''externalGuarantee'' then return komisio_private.guaranteed_sale_facts(p_tenant,p_item,p_price_ore); end if;');
 d:=replace(pg_get_functiondef('komisio_private.record_sale_core(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb)'::regprocedure),E'\r','');
 needle:='vat_mode,vat_rate_bp,vat_basis,vat_ore,agreement_version_id,seller_terms_version,store_policy_version)';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SALE_COLUMNS'; end if;
 d:=replace(d,needle,'vat_mode,vat_rate_bp,vat_basis,vat_ore,agreement_version_id,seller_terms_version,store_policy_version,guarantee_id,accounting_pending)');
 needle:='(facts->>''storePolicyVersion'')::integer)';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SALE_VALUES'; end if;
 d:=replace(d,needle,'(facts->>''storePolicyVersion'')::integer,(facts->>''guaranteeId'')::uuid,coalesce((facts->>''accountingPending'')::boolean,false))');
 needle:='if facts->>''ownership''=''consignment'' and (facts->>''sellerCreditOre'')::bigint>0 then';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SALE_CREDIT'; end if;
 execute replace(d,needle,'if facts->>''guaranteeId'' is not null then perform komisio_private.record_guaranteed_sale(p_tenant,line_id);
  elsif facts->>''ownership''=''consignment'' and (facts->>''sellerCreditOre'')::bigint>0 then');
 d:=replace(pg_get_functiondef('komisio_private.record_return_core(uuid,uuid,uuid,bigint,text,timestamptz)'::regprocedure),E'\r','');
 needle:='if line.ownership=''consignment'' and line.seller_credit_ore>0 then';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_RETURN_CREDIT'; end if;
 d:=replace(d,needle,'if line.guarantee_id is null and line.ownership=''consignment'' and line.seller_credit_ore>0 then');
 needle:='perform komisio_private.record_'||'access(p_tenant,''sale.returned''';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_RETURN_AUDIT'; end if;
 execute replace(d,needle,'if line.guarantee_id is not null then
  insert into public.external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,sale_line_id,return_id,recorded_by,effective_at)
  values(komisio_private.derived_id(p_id::text||'':guaranteed-return''),p_tenant,line.guarantee_id,''returned'',line.item_id,line.id,p_id,uid,p_occurred_at);
 end if; '||needle);
end $$;

-- Fixed credits participate in the existing balance, without changing the API.
do $$ declare d text; begin
 d:=pg_get_functiondef('komisio_private.seller_balance_facts(uuid,uuid)'::regprocedure);
 if position('where kind=''credit_sale''' in d)=0 then raise exception 'UNEXPECTED_SELLER_BALANCE'; end if;
 execute replace(d,'where kind=''credit_sale''','where kind in (''credit_sale'',''credit_guarantee'')');
end $$;
