-- The historic fixed submission RPC keeps its original consignment contract.
alter table public.external_item_requests add column sale_method text not null default 'consignment'
 check(sale_method in ('direct_purchase','consignment') and (sale_method='consignment' or approval_mode='fixed'));

-- Retain every deployed account, consent, photo, capacity and retry check.
do $$ declare d text:=pg_get_functiondef('public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid)'::regprocedure);
begin
 if position('p_agreement uuid)' in d)=0 or position('if prior.approval_mode' in d)=0 or position('seller_id,consent_evidence_id)' in d)=0
 or position('seller.id,evidence)' in d)=0 then raise exception 'UNEXPECTED_SUBMISSION_CONTRACT'; end if;
 d:=replace(d,'p_agreement uuid)','p_agreement uuid, p_sale_method text)');
 d:=replace(d,'if p_price_ore is null then','if p_sale_method is null or p_sale_method not in (''direct_purchase'',''consignment'') then raise exception ''INVALID_INPUT''; end if; if p_price_ore is null then');
 d:=replace(d,'if prior.approval_mode','if prior.sale_method is distinct from p_sale_method or prior.approval_mode');
 d:=replace(d,'seller_id,consent_evidence_id)','seller_id,consent_evidence_id,sale_method)');
 execute replace(d,'seller.id,evidence)','seller.id,evidence,p_sale_method)');
end $$;
create or replace function public.submit_central_item_request(p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,p_price_ore numeric,p_currency text,p_photos uuid[],p_sender_country text,p_price_basis text,p_agreement uuid)
returns uuid language sql security invoker set search_path='' as $$
 select public.submit_central_item_request(p_id,p_tenant,p_description,p_brand,p_condition,p_notes,p_price_ore,p_currency,p_photos,p_sender_country,p_price_basis,p_agreement,'consignment');
$$;
revoke all on function public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid,text) to authenticated;

create table komisio_private.central_direct_purchases (
 request_id uuid primary key references public.external_item_requests(id),
 tenant_id uuid not null, command_id uuid not null unique, purchase_id uuid not null unique, ledger_id uuid not null unique,
 foreign key(tenant_id,purchase_id) references public.purchase_receipts(tenant_id,id),
 foreign key(tenant_id,ledger_id) references public.seller_ledger_entries(tenant_id,id)
);
alter table komisio_private.central_direct_purchases enable row level security;
create trigger support_read_only_guard before insert or update or delete or truncate on komisio_private.central_direct_purchases for each statement execute function komisio_private.guard_support_write();
revoke all on komisio_private.central_direct_purchases from public,anon,authenticated;
create trigger preserve before update or delete on komisio_private.central_direct_purchases for each row execute function komisio_private.preserve_reception();

alter table public.seller_ledger_entries drop constraint seller_ledger_entries_kind_check,
 drop constraint seller_ledger_entries_reference_kind_check, drop constraint seller_ledger_entries_check;
alter table public.seller_ledger_entries
 add constraint seller_ledger_entries_kind_check check(kind in ('credit_sale','credit_purchase','credit_guarantee','credit_reversal','payout_reserved','payout_paid','payout_released','booking_charge','adjustment','consignment_fee','consignment_fee_reversal')),
 add constraint seller_ledger_entries_reference_kind_check check(reference_kind in ('purchase_receipt','sale_line','external_guarantee','sale_return','payout','booking','adjustment','consignment_fee')),
 add constraint ledger_purchase_reference check((kind='credit_purchase')=(reference_kind='purchase_receipt')),
 add constraint seller_ledger_entries_check check((kind in ('credit_purchase','credit_sale','credit_guarantee','payout_released','consignment_fee_reversal') and amount_ore>0)
 or (kind in ('credit_reversal','payout_reserved','payout_paid','booking_charge','consignment_fee') and amount_ore<0) or kind='adjustment');
create unique index seller_ledger_one_purchase_credit on public.seller_ledger_entries(tenant_id,reference_id) where kind='credit_purchase';

create function public.inspect_central_direct_purchase(p_tenant uuid,p_request uuid,p_command uuid,p_margin_eligible boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); r public.external_item_requests;
 prior komisio_private.central_direct_purchases; receipt uuid; credit uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff')
 or not exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_command is null or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 select * into r from public.external_item_requests where tenant_id=p_tenant and id=p_request and sale_method='direct_purchase' and approval_mode='fixed';
 if r.id is null then raise exception 'REQUEST_CHANGED'; end if;
 perform komisio_private.lock_external_owner(r.owner_id);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff')
 or not exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from komisio_private.central_direct_purchases where request_id=r.id or command_id=p_command;
 if found then
  if prior.request_id<>r.id or prior.command_id<>p_command or not exists(select 1 from public.purchase_receipts where id=prior.purchase_id and created_by=uid and margin_eligible=p_margin_eligible)
  then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.purchase_id;
 end if;
 if not exists(select 1 from public.external_item_offers o join public.external_item_handover_links l on l.offer_id=o.id and l.tenant_id=o.tenant_id
 join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=l.tenant_id
 where o.request_id=r.id and o.tenant_id=r.tenant_id and o.approval_source='fixed_request' and h.status='received'
 and h.received_at is not null and l.seller_id=r.seller_id and l.owner_id=r.owner_id) then raise exception 'REQUEST_CHANGED'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=r.seller_id and external_owner_id=r.owner_id and privacy_closed_at is null) then raise exception 'SELLER_CLOSED'; end if;
 perform komisio_private.require_writable(p_tenant);
 receipt:=komisio_private.derived_id(r.id::text||':direct-purchase');
 credit:=komisio_private.derived_id(r.id::text||':direct-credit');
 if komisio_private.store_currency(p_tenant) is distinct from r.currency then raise exception 'REQUEST_CHANGED'; end if;
 if exists(select 1 from public.purchase_receipts where id=receipt) then raise exception 'REQUEST_CONFLICT'; end if;
 perform public.register_purchase(p_tenant,receipt,r.description,r.desired_price_ore::bigint,'Central item '||r.id::text,p_margin_eligible);
 insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
 values(credit,p_tenant,r.seller_id,'credit_purchase',r.desired_price_ore,'purchase_receipt',receipt,clock_timestamp(),uid);
 insert into komisio_private.central_direct_purchases(request_id,tenant_id,command_id,purchase_id,ledger_id) values(r.id,p_tenant,p_command,receipt,credit);
 perform komisio_private.record_access(p_tenant,'central_item.purchased',receipt,jsonb_build_object('requestId',r.id,'ledgerId',credit,'agreementId',r.agreement_version_id));
 return receipt;
end $$;
revoke all on function public.inspect_central_direct_purchase(uuid,uuid,uuid,boolean) from public,authenticated,anon;
grant execute on function public.inspect_central_direct_purchase(uuid,uuid,uuid,boolean) to authenticated;

-- Extend projections inside their existing authorization boundary.
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('komisio_private.ensure_external_item_guarantees(uuid,uuid)'::regprocedure);
 needle:='where l.tenant_id=p_tenant and l.handover_id=p_handover';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_RECEIPT_CONTRACT'; end if;
 execute replace(d,needle,needle||' and exists(select 1 from public.external_item_requests req where req.id=o.request_id and req.sale_method=''consignment'')');
 d:=pg_get_functiondef('komisio_private.external_request_state(uuid,timestamptz)'::regprocedure);
 needle:='when d.withdrawn';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_REQUEST_STATE'; end if;
 execute replace(d,needle,'when r.sale_method=''direct_purchase'' and exists(select 1 from komisio_private.central_direct_purchases p where p.request_id=r.id) then ''acquired'' '||needle);
 d:=pg_get_functiondef('public.my_external_item_requests_page(integer,uuid,text)'::regprocedure);
 needle:='r.price_basis,r.approval_mode,';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SELLER_ROWS'; end if;
 execute replace(d,needle,needle||'r.sale_method,');
 d:=pg_get_functiondef('public.central_request_queue(uuid,integer,text,text,uuid)'::regprocedure);
 needle:='r.id,r.owner_id,r.approval_mode,';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_STAFF_ROWS'; end if;
 execute replace(d,needle,needle||'r.sale_method,(select p.purchase_id from komisio_private.central_direct_purchases p where p.request_id=r.id) as direct_purchase_id,');
 d:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 needle:='''sellerAmountOre'',offer.seller_amount_ore';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_OFFER_READ'; end if;
 execute replace(d,needle,'''saleMethod'',(select r.sale_method from public.external_item_requests r where r.id=offer.request_id),
  ''purchaseCreditedAt'',(select l.occurred_at from komisio_private.central_direct_purchases p join public.seller_ledger_entries l on l.id=p.ledger_id where p.request_id=offer.request_id),'||needle);
 d:=pg_get_functiondef('komisio_private.seller_balance_facts(uuid,uuid)'::regprocedure);
 needle:='where kind in (''credit_sale'',''credit_guarantee'')';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BALANCE_FACTS'; end if;
 execute replace(d,needle,'where kind in (''credit_sale'',''credit_guarantee'',''credit_purchase'')');
end $$;
-- Preserve the existing accounting boundary for income credited before a sale.
do $$ declare d text; signature text; needle text:='e.kind=''credit_guarantee'''; begin
 foreach signature in array array['komisio_private.require_guarantee_accounting_ready(uuid,date)',
  'public.issue_statement(uuid,uuid,uuid,timestamptz,timestamptz,uuid)',
  'komisio_private.seller_type_totals(uuid,date,date)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position(needle in d)=0 then raise exception 'UNEXPECTED_ACCOUNTING_CONTRACT'; end if;
  execute replace(d,needle,'e.kind in (''credit_guarantee'',''credit_purchase'')');
 end loop;
end $$;
notify pgrst,'reload schema';

