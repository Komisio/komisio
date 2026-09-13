-- P2 S13: a return is a new fact that reverses one sale line in full. It
-- reverses the seller credit in the ledger, puts the item back on sale, and
-- flags itself for review when the seller's money had already been reserved
-- or paid out. Partial refunds are rejected in P2. The sale row is untouched.
create table public.sale_returns (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 sale_line_id uuid not null,
 item_id uuid not null,
 refund_ore bigint not null check(refund_ore>0),
 reason text not null check(length(trim(reason)) between 1 and 500),
 flagged_for_review boolean not null default false,
 flag_reason text not null default '' check(length(flag_reason)<=200),
 occurred_at timestamptz not null,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,sale_line_id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create index sale_returns_tenant on public.sale_returns(tenant_id,occurred_at desc,id);
alter table public.sale_returns enable row level security;
create policy sale_returns_read on public.sale_returns for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.sale_returns from public,anon,authenticated;
grant select on public.sale_returns to authenticated;
create trigger sale_returns_immutable before update or delete on public.sale_returns for each row execute function komisio_private.preserve_sale();
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance','sold','returned'));

-- A returned line no longer counts as sold: the item can be sold again.
create or replace function komisio_private.sale_line_facts(p_tenant uuid,p_item uuid,p_price_ore bigint,p_policy jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; terms jsonb; basis text; rate numeric; rate_bp integer; commission bigint:=0; commission_vat bigint:=0; credit bigint:=0;
 vat_rate_bp integer; mode text; seller_taxable boolean; margin_attested boolean; vat_basis jsonb; vat bigint;
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
   where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)) then raise exception 'ITEM_ALREADY_SOLD'; end if;
 terms:=item.terms;
 vat_rate_bp:=round(coalesce((p_policy->>'vatRatePercent')::numeric,25)*100)::integer;
 if item.ownership='consignment' then
  basis:=terms->>'commissionBasis'; rate:=(terms->>'commissionRatePercent')::numeric;
  if basis not in ('inclusive','exclusive') or rate is null then raise exception 'INVALID_INPUT'; end if;
  rate_bp:=round(rate*100)::integer;
  commission:=komisio_private.share_ore(p_price_ore,rate_bp);
  if basis='exclusive' then commission_vat:=komisio_private.commission_invoice_vat(commission,vat_rate_bp); end if;
  credit:=p_price_ore-commission-commission_vat;
  if credit<0 then raise exception 'INVALID_INPUT'; end if;
  seller_taxable:=basis='exclusive';
  if seller_taxable then mode:='consignment_business';
  else
   mode:=p_policy->>'vatModeConsignmentPrivate';
   if mode is null then raise exception 'VAT_MODE_NOT_SET'; end if;
  end if;
  vat_basis:=jsonb_build_object('priceOre',p_price_ore,'sellerCreditOre',credit,'commissionExVatOre',case when seller_taxable then commission else null end);
  vat:=komisio_private.vat_for_line(mode,p_price_ore,credit,null,vat_rate_bp);
 else
  margin_attested:=coalesce((terms->>'marginEligible')::boolean,false);
  mode:=p_policy->>'vatModeStoreOwned';
  if mode is null then raise exception 'VAT_MODE_NOT_SET'; end if;
  if mode='store_margin' and not margin_attested then mode:='store_full'; end if;
  vat_basis:=jsonb_build_object('priceOre',p_price_ore,'purchasePriceOre',(terms->>'purchasePriceOre')::bigint,'marginAttested',margin_attested);
  vat:=komisio_private.vat_for_line(mode,p_price_ore,null,(terms->>'purchasePriceOre')::bigint,vat_rate_bp);
 end if;
 return jsonb_build_object('itemId',item.id,'priceOre',p_price_ore,'ownership',item.ownership,'commissionBasis',basis,'commissionRatePercent',rate,
  'commissionOre',commission,'commissionVatOre',commission_vat,'sellerCreditOre',credit,'sellerId',item.seller_id,
  'vatMode',mode,'vatRateBp',vat_rate_bp,'vatBasis',vat_basis,'vatOre',vat,
  'agreementVersionId',terms->'agreementVersionId','sellerTermsVersion',terms->'sellerTermsVersion','storePolicyVersion',terms->'storePolicyVersion');
end $$;

create function public.record_return(p_tenant uuid,p_id uuid,p_sale_line uuid,p_refund_ore bigint,p_reason text,p_occurred_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sale_returns; line public.sale_lines; sale public.sales; note text:=trim(coalesce(p_reason,''));
 available bigint; flagged boolean:=false; flag text:='';
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_sale_line is null or p_refund_ore is null or p_refund_ore<=0 or length(note) not between 1 and 500
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.sale_returns where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.sale_line_id is distinct from p_sale_line or prior.refund_ore is distinct from p_refund_ore
   or prior.reason is distinct from note or prior.recorded_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into line from public.sale_lines where tenant_id=p_tenant and id=p_sale_line;
 if not found then raise exception 'SALE_LINE_NOT_FOUND'; end if;
 select * into sale from public.sales where tenant_id=p_tenant and id=line.sale_id;
 if sale.status<>'completed' then raise exception 'SALE_NOT_COMPLETED'; end if;
 if exists(select 1 from public.sale_returns where tenant_id=p_tenant and sale_line_id=p_sale_line) then raise exception 'LINE_ALREADY_RETURNED'; end if;
 if p_refund_ore<>line.price_ore then raise exception 'PARTIAL_REFUND_UNSUPPORTED'; end if;
 if p_occurred_at<sale.occurred_at then raise exception 'INVALID_INPUT'; end if;
 if line.ownership='consignment' and line.seller_credit_ore>0 then
  available:=komisio_private.available_ore(p_tenant,(select seller_id from public.items where tenant_id=p_tenant and id=line.item_id));
  -- The credit may already be reserved or paid out: the reversal still lands, but a person must look.
  if available<line.seller_credit_ore then flagged:=true; flag:='CREDIT_ALREADY_USED'; end if;
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
  select gen_random_uuid(),p_tenant,i.seller_id,'credit_reversal',-line.seller_credit_ore,'sale_return',p_id,note,p_occurred_at,uid from public.items i where i.tenant_id=p_tenant and i.id=line.item_id;
 end if;
 insert into public.sale_returns(id,tenant_id,sale_line_id,item_id,refund_ore,reason,flagged_for_review,flag_reason,occurred_at,recorded_by)
 values(p_id,p_tenant,p_sale_line,line.item_id,p_refund_ore,note,flagged,flag,p_occurred_at,uid);
 insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,line.item_id,'returned',jsonb_build_object('returnId',p_id,'saleId',line.sale_id,'lineNo',line.line_no,'refundOre',p_refund_ore,'flagged',flagged),uid);
 perform komisio_private.record_access(p_tenant,'sale.returned',p_id,jsonb_build_object('sale_line_id',p_sale_line,'refund_ore',p_refund_ore,'flagged',flagged));
 return p_id;
end $$;
revoke all on function public.record_return(uuid,uuid,uuid,bigint,text,timestamptz) from public,anon;
grant execute on function public.record_return(uuid,uuid,uuid,bigint,text,timestamptz) to authenticated;
