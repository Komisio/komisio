-- P2 S11: the sale as a fact from a POS or the counter, idempotent, with the
-- commercial and VAT basis frozen per line. Commission and seller credit come
-- from the item's frozen terms; the VAT mode comes from the tenant policy at
-- sale time (docs/VAT-CASES.md). Nothing here is edited afterwards; S13 adds
-- returns as new facts.
create table public.sales (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 provider text not null check(provider in ('manual','zettle','shopify')),
 external_id text not null check(length(external_id) between 1 and 200),
 currency text not null check(currency='SEK'),
 occurred_at timestamptz not null,
 total_ore bigint not null check(total_ore>=0),
 status text not null default 'completed' check(status in ('completed','reversed')),
 provider_reference jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_reference)='object'),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,provider,external_id)
);
create index sales_tenant on public.sales(tenant_id,occurred_at desc,id);
create table public.sale_lines (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 sale_id uuid not null,
 item_id uuid not null,
 line_no integer not null check(line_no>0),
 price_ore bigint not null check(price_ore>0 and price_ore<=99999999999),
 ownership text not null check(ownership in ('consignment','store')),
 commission_basis text check(commission_basis in ('inclusive','exclusive')),
 commission_rate_percent numeric(5,2),
 commission_ore bigint not null default 0 check(commission_ore>=0),
 commission_vat_ore bigint not null default 0 check(commission_vat_ore>=0),
 seller_credit_ore bigint not null default 0 check(seller_credit_ore>=0),
 vat_mode text not null check(vat_mode in ('consignment_margin','consignment_full','consignment_business','store_margin','store_full')),
 vat_rate_bp integer not null check(vat_rate_bp between 0 and 10000),
 vat_basis jsonb not null check(jsonb_typeof(vat_basis)='object'),
 vat_ore bigint not null check(vat_ore>=0),
 agreement_version_id uuid,
 seller_terms_version integer,
 store_policy_version integer not null,
 foreign key(tenant_id,sale_id) references public.sales(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 unique(tenant_id,sale_id,line_no),
 check((ownership='store')=(commission_basis is null))
);
create index sale_lines_sale on public.sale_lines(tenant_id,sale_id,line_no);
create index sale_lines_item on public.sale_lines(tenant_id,item_id);
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
create policy sales_read on public.sales for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy sale_lines_read on public.sale_lines for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.sales,public.sale_lines from public,anon,authenticated;
grant select on public.sales,public.sale_lines to authenticated;
create function komisio_private.preserve_sale() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_SALE' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_sale() from public,anon,authenticated;
create trigger sales_immutable before update or delete on public.sales for each row execute function komisio_private.preserve_sale();
create trigger sale_lines_immutable before update or delete on public.sale_lines for each row execute function komisio_private.preserve_sale();
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance','sold'));

-- amount × rate_bp ÷ 10000, rounded half up. Used for the commission share.
create function komisio_private.share_ore(p_amount_ore bigint,p_rate_bp integer) returns bigint
language sql immutable set search_path='' as $$
 select case when p_amount_ore<=0 or p_rate_bp<=0 then 0 else div((p_amount_ore::numeric*p_rate_bp)*2+10000,20000) end::bigint;
$$;

-- One line's frozen commercial and VAT facts, computed from the item's frozen
-- terms and the tenant policy in force. Pure apart from reads; no write.
create function komisio_private.sale_line_facts(p_tenant uuid,p_item uuid,p_price_ore bigint,p_policy jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; terms jsonb; basis text; rate numeric; rate_bp integer; commission bigint:=0; commission_vat bigint:=0; credit bigint:=0;
 vat_rate_bp integer; mode text; seller_taxable boolean; margin_attested boolean; vat_basis jsonb; vat bigint;
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed') then raise exception 'ITEM_ALREADY_SOLD'; end if;
 terms:=item.terms;
 vat_rate_bp:=round(coalesce((p_policy->>'vatRatePercent')::numeric,25)*100)::integer;
 if item.ownership='consignment' then
  basis:=terms->>'commissionBasis'; rate:=(terms->>'commissionRatePercent')::numeric;
  if basis not in ('inclusive','exclusive') or rate is null then raise exception 'INVALID_INPUT'; end if;
  rate_bp:=round(rate*100)::integer;
  commission:=komisio_private.share_ore(p_price_ore,rate_bp);
  -- Exclusive: the commission is invoiced to the seller plus VAT (interim proxy for a VAT-registered seller).
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
  -- Without an attestation the item sells under store_full, never on margin.
  if mode='store_margin' and not margin_attested then mode:='store_full'; end if;
  vat_basis:=jsonb_build_object('priceOre',p_price_ore,'purchasePriceOre',(terms->>'purchasePriceOre')::bigint,'marginAttested',margin_attested);
  vat:=komisio_private.vat_for_line(mode,p_price_ore,null,(terms->>'purchasePriceOre')::bigint,vat_rate_bp);
 end if;
 return jsonb_build_object('itemId',item.id,'priceOre',p_price_ore,'ownership',item.ownership,'commissionBasis',basis,'commissionRatePercent',rate,
  'commissionOre',commission,'commissionVatOre',commission_vat,'sellerCreditOre',credit,'sellerId',item.seller_id,
  'vatMode',mode,'vatRateBp',vat_rate_bp,'vatBasis',vat_basis,'vatOre',vat,
  'agreementVersionId',terms->'agreementVersionId','sellerTermsVersion',terms->'sellerTermsVersion','storePolicyVersion',terms->'storePolicyVersion');
end $$;
revoke all on function komisio_private.share_ore(bigint,integer),komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb) from public,anon,authenticated;

create function komisio_private.valid_sale_lines(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; seen uuid[]:='{}'; iid uuid;
begin
 if value is null or jsonb_typeof(value)<>'array' or jsonb_array_length(value) not between 1 and 50 then return false; end if;
 for line in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(line)<>'object' or not(line ?& array['itemId','priceOre']) or (line-array['itemId','priceOre'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(line->'itemId')<>'string' or (line->>'itemId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(line->'priceOre')<>'number' or (line->>'priceOre') !~ '^[1-9][0-9]{0,10}$' or (line->>'priceOre')::bigint>99999999999 then return false; end if;
  iid:=(line->>'itemId')::uuid;
  if iid=any(seen) then return false; end if;
  seen:=array_append(seen,iid);
 end loop;
 return true;
end $$;
revoke all on function komisio_private.valid_sale_lines(jsonb) from public,anon,authenticated;

-- Same computation as record_sale, no write. The UI preview and tests use it.
create function public.simulate_sale(p_tenant uuid,p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pol jsonb; line jsonb; facts jsonb; lines jsonb:='[]'::jsonb; total bigint:=0; n integer:=0;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not komisio_private.valid_sale_lines(p_lines) then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 for line in select * from jsonb_array_elements(p_lines) loop
  n:=n+1;
  facts:=komisio_private.sale_line_facts(p_tenant,(line->>'itemId')::uuid,(line->>'priceOre')::bigint,pol)||jsonb_build_object('lineNo',n);
  lines:=lines||facts; total:=total+(line->>'priceOre')::bigint;
 end loop;
 return jsonb_build_object('simulated',true,'totalOre',total,'lines',lines);
end $$;

create function public.record_sale(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sales; pol jsonb; line jsonb; facts jsonb; computed jsonb:='[]'::jsonb; total bigint:=0; n integer:=0; ext text:=trim(p_external_id); existing_lines jsonb;
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
 -- Compute every line first so the total is known before the sale row exists.
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
   facts->>'vatMode',(facts->>'vatRateBp')::integer,facts->'vatBasis',(facts->>'vatOre')::bigint,(facts->>'agreementVersionId')::uuid,(facts->>'sellerTermsVersion')::integer,(facts->>'storePolicyVersion')::integer);
  insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,(facts->>'itemId')::uuid,'sold',jsonb_build_object('saleId',p_id,'lineNo',(facts->>'lineNo')::integer,'priceOre',(facts->>'priceOre')::bigint,'provider',p_provider),uid);
 end loop;
 perform komisio_private.record_access(p_tenant,'sale.recorded',p_id,jsonb_build_object('provider',p_provider,'external_id',ext,'lines',n,'total_ore',total));
 return p_id;
end $$;
revoke all on function public.simulate_sale(uuid,jsonb),public.record_sale(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb) from public,anon;
grant execute on function public.simulate_sale(uuid,jsonb),public.record_sale(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb) to authenticated;
