-- One currency per store (owner decision 2026-09-13). The store policy names
-- it (SEK, NOK, DKK or EUR; absent means SEK), every money fact records it,
-- and it is frozen once the store has recorded a sale, a purchase or a
-- payout. Amounts stay integers in the currency's minor unit; nothing
-- converts. Functions that assumed SEK now compare with the store's currency.
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota','automaticSellerNotifications','automaticMarkdowns','currency'];
 if not(value ?& allowed) or (value-allowed-optional)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
 if value ? 'currency' and (jsonb_typeof(value->'currency')<>'string' or value->>'currency' not in ('SEK','NOK','DKK','EUR')) then return false; end if;
 if value ? 'vatModeConsignmentPrivate' and (jsonb_typeof(value->'vatModeConsignmentPrivate')<>'string' or value->>'vatModeConsignmentPrivate' not in ('consignment_margin','consignment_full')) then return false; end if;
 if value ? 'vatModeStoreOwned' and (jsonb_typeof(value->'vatModeStoreOwned')<>'string' or value->>'vatModeStoreOwned' not in ('store_margin','store_full')) then return false; end if;
 if value ? 'vatRatePercent' then
  if jsonb_typeof(value->'vatRatePercent')<>'number' then return false; end if;
  n:=(value->>'vatRatePercent')::numeric;
  if n<0 or n>100 or n<>round(n,2) then return false; end if;
 end if;
 if value ? 'assistanceEnabled' and jsonb_typeof(value->'assistanceEnabled')<>'boolean' then return false; end if;
 if value ? 'automaticSellerNotifications' and jsonb_typeof(value->'automaticSellerNotifications')<>'boolean' then return false; end if;
 if value ? 'automaticMarkdowns' and jsonb_typeof(value->'automaticMarkdowns')<>'boolean' then return false; end if;
 if value ? 'assistanceMonthlyQuota' then
  if jsonb_typeof(value->'assistanceMonthlyQuota')<>'number' then return false; end if;
  n:=(value->>'assistanceMonthlyQuota')::numeric;
  if n<0 or n>1000000 or n<>trunc(n) then return false; end if;
 end if;
 foreach k in array array['commissionRatePercent','minPayoutThreshold','salePeriodDays','unsoldNotifyAfterDays'] loop
  v:=value->k;
  if jsonb_typeof(v)<>'number' then return false; end if;
  n:=(v#>>'{}')::numeric;
  if n<0 or n>9007199254740991 then return false; end if;
  if k in ('salePeriodDays','unsoldNotifyAfterDays') then
   if n<>trunc(n) or (k='salePeriodDays' and n=0) then return false; end if;
  elsif n<>round(n,2) or (k='commissionRatePercent' and n>100) then return false; end if;
 end loop;
 foreach k in array array['agreementRequiredFor','custodySources'] loop
  v:=value->k;
  if jsonb_typeof(v)<>'array' then return false; end if;
  if jsonb_array_length(v)>3 or (select count(*)<>count(distinct x) from jsonb_array_elements(v) x) then return false; end if;
  allowed:=case when k='agreementRequiredFor' then array['bag_receipt','review_publication','acceptance'] else array['staff_receipt','locker','seller_dropoff'] end;
  if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or not((x#>>'{}')=any(allowed))) then return false; end if;
 end loop;
 if jsonb_typeof(value->'markdownSteps')<>'array' then return false; end if;
 for step in select * from jsonb_array_elements(value->'markdownSteps') loop
  if jsonb_typeof(step)<>'object' then return false; end if;
  if not(step ?& array['afterDays','percent']) or (step-array['afterDays','percent'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(step->'afterDays')<>'number' or jsonb_typeof(step->'percent')<>'number' then return false; end if;
  n:=(step->>'afterDays')::numeric;
  if n<0 or n>9007199254740991 or n<>trunc(n) then return false; end if;
  n:=(step->>'percent')::numeric;
  if n<0 or n>100 or n<>round(n,2) then return false; end if;
 end loop;
 return true;
end $$;

-- The store's currency: the current policy's, SEK when none was chosen.
create function komisio_private.store_currency(p_tenant uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select policy->>'currency' from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1),'SEK');
$$;
revoke all on function komisio_private.store_currency(uuid) from public,anon,authenticated;
-- Any signed-in person may ask a store's currency: the seller portal shows
-- amounts in it and it reveals nothing else.
create function public.store_currency(p_tenant uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'INVALID_INPUT'; end if;
 return komisio_private.store_currency(p_tenant);
end $$;
revoke all on function public.store_currency(uuid) from public,anon;
grant execute on function public.store_currency(uuid) to authenticated;

-- Publishing a policy with another currency is refused once money facts exist.
create or replace function public.publish_store_policy(p_tenant uuid,p_id uuid,p_expected_current uuid,p_policy jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.store_policy_versions; current_version public.store_policy_versions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_store_policy(p_policy) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_policy_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid
   or prior.previous_id is distinct from p_expected_current or prior.policy is distinct from p_policy then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'POLICY_CHANGED'; end if;
 if coalesce(current_version.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 if coalesce(p_policy->>'currency','SEK')<>komisio_private.store_currency(p_tenant)
  and (exists(select 1 from public.sales where tenant_id=p_tenant) or exists(select 1 from public.purchase_receipts where tenant_id=p_tenant) or exists(select 1 from public.payouts where tenant_id=p_tenant)) then
  raise exception 'CURRENCY_FROZEN';
 end if;
 insert into public.store_policy_versions(id,tenant_id,version,previous_id,policy,created_by)
 values(p_id,p_tenant,coalesce(current_version.version,0)+1,p_expected_current,p_policy,uid);
 perform komisio_private.record_access(p_tenant,'store_policy.published',p_id,jsonb_build_object('version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;

alter table public.sales drop constraint if exists sales_currency_check;
alter table public.sales add constraint sales_currency_check check(currency in ('SEK','NOK','DKK','EUR'));
alter table public.payouts drop constraint if exists payouts_currency_check;
alter table public.payouts add constraint payouts_currency_check check(currency in ('SEK','NOK','DKK','EUR'));
alter table public.purchase_receipts drop constraint if exists purchase_receipts_currency_check;
alter table public.purchase_receipts add constraint purchase_receipts_currency_check check(currency in ('SEK','NOK','DKK','EUR'));

create or replace function public.record_sale(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sales; pol jsonb; line jsonb; facts jsonb; computed jsonb:='[]'::jsonb; total bigint:=0; n integer:=0; ext text:=trim(p_external_id); existing_lines jsonb; line_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_provider is null or p_provider not in ('manual','zettle','shopify') or ext is null or length(ext) not between 1 and 200
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' or p_currency is null
  or p_reference is null or jsonb_typeof(p_reference)<>'object' or not komisio_private.valid_sale_lines(p_lines) then raise exception 'INVALID_INPUT'; end if;
 if p_currency<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
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
 values(p_id,p_tenant,p_provider,ext,p_currency,p_occurred_at,total,p_reference,uid);
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
 perform komisio_private.record_access(p_tenant,'sale.recorded',p_id,jsonb_build_object('provider',p_provider,'external_id',ext,'lines',n,'total_ore',total,'currency',p_currency));
 return p_id;
end $$;

create or replace function komisio_private.request_payout_core(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint,p_source text) returns uuid
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
 insert into public.payouts(id,tenant_id,seller_id,amount_ore,currency,requested_by,request_source) values(p_id,p_tenant,p_seller,p_amount_ore,komisio_private.store_currency(p_tenant),uid,p_source);
 insert into public.payout_events(id,tenant_id,payout_id,kind,actor) values(p_id,p_tenant,p_id,'requested',uid);
 perform komisio_private.record_access(p_tenant,'payout.requested',p_id,jsonb_build_object('seller_id',p_seller,'amount_ore',p_amount_ore));
 return p_id;
end $$;

create or replace function public.register_purchase(p_tenant uuid,p_id uuid,p_note text,p_price_ore bigint,p_evidence text,p_margin_eligible boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.purchase_receipts; n text:=trim(coalesce(p_note,'')); e text:=trim(coalesce(p_evidence,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_price_ore is null or p_price_ore<0 or p_price_ore>99999999999 or length(n)>500
  or length(e) not between 1 and 500 or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.purchase_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid or previous.supplier_note is distinct from n
   or previous.purchase_price_ore is distinct from p_price_ore or previous.evidence_reference is distinct from e
   or previous.margin_eligible is distinct from p_margin_eligible then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 insert into public.purchase_receipts(id,tenant_id,supplier_note,purchase_price_ore,currency,evidence_reference,margin_eligible,created_by)
 values(p_id,p_tenant,n,p_price_ore,komisio_private.store_currency(p_tenant),e,p_margin_eligible,uid);
 perform komisio_private.record_access(p_tenant,'purchase.registered',p_id,jsonb_build_object('price_ore',p_price_ore,'margin_eligible',p_margin_eligible));
 return p_id;
end $$;

-- A reception review's price may name any supported currency structurally;
-- publication requires the store's.
create or replace function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare metadata jsonb; price jsonb; fact jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['metadata','price','questions']) or (value-array['metadata','price','questions'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 metadata:=value->'metadata'; price:=value->'price';
 if jsonb_typeof(metadata)<>'object' or jsonb_typeof(price)<>'object' then return false; end if;
 if not(metadata ? 'description') or (metadata-array['description','category','color','brand','size','material','condition'])<>'{}'::jsonb then return false; end if;
 for fact in select v from jsonb_each(metadata) as fields(k,v) loop
  if jsonb_typeof(fact)<>'object' then return false; end if;
  if not(fact ?& array['value','sourceIds','certainty']) or (fact-array['value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(fact->'value')<>'string' or length(trim(fact->>'value')) not between 1 and 1000 or length(fact->>'value')>1000
   or fact->>'certainty' is distinct from 'observed' or not komisio_private.valid_reception_refs(fact->'sourceIds') then return false; end if;
 end loop;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;

create or replace function public.publish_reception_review(p_tenant uuid,p_request uuid,p_session uuid,p_source_revision integer,p_previous uuid,p_agreement uuid,p_suggestions jsonb,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_reviews where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid
   or prior.source_revision is distinct from p_source_revision or prior.previous_review_id is distinct from p_previous
   or prior.agreement_id is distinct from p_agreement or prior.suggestions is distinct from p_suggestions or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if p_suggestions->'price'->>'currency'<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 select s.email into address from public.reception_sessions r join public.sellers s on s.id=r.seller_id and s.tenant_id=r.tenant_id where r.id=p_session and r.tenant_id=p_tenant;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into src from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if not found or src.revision<>p_source_revision then raise exception 'RECEPTION_CHANGED'; end if;
 select * into latest from public.reception_reviews where session_id=p_session order by version desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
 if coalesce(latest.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_agreement is null and ((public.current_store_policy(p_tenant)->'policy'->'agreementRequiredFor') ? 'review_publication') then raise exception 'AGREEMENT_REQUIRED'; end if;
 if not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'RECEPTION_REVIEW_EXPIRED'; end if;
 for fact in select v from jsonb_each(p_suggestions->'metadata') as fields(k,v) loop
  for ref in select * from jsonb_array_elements_text(fact->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
 end loop;
 for ref in select * from jsonb_array_elements_text(p_suggestions->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,p_suggestions,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $$;

-- Zettle: a purchase in any supported currency is structurally valid; a
-- purchase not in the store's currency is held, never recorded.
create or replace function komisio_private.valid_zettle_purchase(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb;n integer:=0;total numeric:=0;
begin
 if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['externalId','occurredAt','currency','amountOre','blockedReason','lines']) or (p-array['externalId','occurredAt','currency','amountOre','blockedReason','lines'])<>'{}'::jsonb then return false;end if;
 if jsonb_typeof(p->'externalId')<>'string' or (p->>'externalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'occurredAt')<>'string' or not isfinite((p->>'occurredAt')::timestamptz) then return false;end if;
 if jsonb_typeof(p->'currency')<>'string' or length(p->>'currency') not between 1 and 10 or (p->>'amountOre') !~ '^-?[0-9]{1,11}$' or jsonb_typeof(p->'amountOre')<>'number' then return false;end if;
 if p->'blockedReason'<>'null'::jsonb and p->>'blockedReason' not in ('source','refund','currency','discount','service_charge','quantity','product_type','amount') then return false;end if;
 if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 50 then return false;end if;
 for line in select * from jsonb_array_elements(p->'lines') loop
  n:=n+1;
  if jsonb_typeof(line)<>'object' or not(line ?& array['lineNo','reference','labelConflict','description','priceOre']) or (line-array['lineNo','reference','labelConflict','description','priceOre','productUuid','variantUuid'])<>'{}'::jsonb then return false;end if;
  if line->'lineNo'<>to_jsonb(n) or jsonb_typeof(line->'labelConflict')<>'boolean' or jsonb_typeof(line->'description')<>'string' or length(line->>'description')>120 then return false;end if;
  if line->'reference'<>'null'::jsonb and (jsonb_typeof(line->'reference')<>'string' or (line->>'reference') !~ '^I-[0-9A-F]{8}$') then return false;end if;
  if jsonb_typeof(line->'priceOre')<>'number' or (line->>'priceOre') !~ '^-?[0-9]{1,11}$' then return false;end if;
  if (line ? 'productUuid' and line->'productUuid'<>'null'::jsonb and (jsonb_typeof(line->'productUuid')<>'string' or (line->>'productUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) or (line ? 'variantUuid' and line->'variantUuid'<>'null'::jsonb and (jsonb_typeof(line->'variantUuid')<>'string' or (line->>'variantUuid')!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then return false;end if;
  total:=total+(line->>'priceOre')::numeric;
  if p->'blockedReason'='null'::jsonb and (line->>'priceOre')::numeric<=0 then return false;end if;
 end loop;
 if p->'blockedReason'='null'::jsonb and (p->>'currency' not in ('SEK','NOK','DKK','EUR') or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 return true;
exception when others then return false;
end $$;

create or replace function komisio_private.ready_zettle_purchase(p_tenant uuid,p_import uuid,p_revision integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt public.zettle_imports;latest integer;line jsonb;matched uuid;lines jsonb:='[]'::jsonb;total numeric:=0;
begin
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 if not found then raise exception 'ZETTLE_IMPORT_NOT_FOUND';end if;
 if receipt.blocked_reason is not null then raise exception 'ZETTLE_UNSUPPORTED_PURCHASE';end if;
 select coalesce(max(revision),0) into latest from public.zettle_line_resolutions where import_id=p_import;
 if latest is distinct from p_revision then raise exception 'ZETTLE_MATCH_CHANGED';end if;
 for line in select * from jsonb_array_elements(receipt.lines) loop
  select item_id into matched from public.zettle_line_resolutions where import_id=p_import and line_no=(line->>'lineNo')::integer order by revision desc limit 1;
  if matched is null then raise exception 'ZETTLE_UNMATCHED_LINES';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('itemId',matched,'priceOre',(line->>'priceOre')::bigint));
  total:=total+(line->>'priceOre')::numeric;
 end loop;
 if not komisio_private.valid_sale_lines(lines) or total<>receipt.amount_ore then raise exception 'INVALID_INPUT';end if;
 if receipt.currency<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH';end if;
 return jsonb_build_object('externalId',receipt.external_id,'occurredAt',receipt.occurred_at,'lines',lines,'amountOre',receipt.amount_ore,'currency',receipt.currency);
end $$;

create or replace function komisio_private.reconcile_zettle_receipt(p_tenant uuid,p_import uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();rev integer;receipt jsonb;result uuid;failure text;last public.zettle_receipt_outcomes;
begin
 select coalesce(max(revision),0) into rev from public.zettle_line_resolutions where tenant_id=p_tenant and import_id=p_import;
 begin
  receipt:=komisio_private.ready_zettle_purchase(p_tenant,p_import,rev);
  result:=public.record_sale(p_tenant,p_import,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,receipt->>'currency',receipt->'lines',jsonb_build_object('zettleImportId',p_import));
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'ZETTLE_RECORD_FAILED' end;
 end;
 select * into last from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import order by created_at desc limit 1;
 if last.mapping_revision=rev and last.sale_id is not distinct from result and last.error_code is not distinct from failure then return result;end if;
 insert into public.zettle_receipt_outcomes(tenant_id,import_id,mapping_revision,sale_id,error_code,created_by) values(p_tenant,p_import,rev,result,failure,uid);
 return result;
end $$;

create or replace function komisio_private.op_execute_zettle_purchase(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
 receipt:=komisio_private.ready_zettle_purchase(p_tenant,(p_payload->>'importId')::uuid,(p_payload->>'mappingRevision')::integer);
 return public.record_sale(p_tenant,p_operation,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,receipt->>'currency',receipt->'lines',jsonb_build_object('zettleImportId',p_payload->>'importId'));
end $$;

create or replace function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;policy_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 policy_id:=(public.current_store_policy(p_tenant)->>'id')::uuid;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,public.current_store_policy(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id and policy_version is not distinct from policy_id order by created_at desc,id desc limit 1;
 if found then return prior.id;end if;
 select product_id,variant_id into pid,vid from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 pid:=coalesce(pid,extensions.uuid_generate_v1mc());vid:=coalesce(vid,extensions.uuid_generate_v1mc());
 if (select count(*) from public.items where tenant_id=p_tenant and left(id::text,8)=left(p_item::text,8))<>1 then raise exception 'ZETTLE_LABEL_AMBIGUOUS';end if;
 if item.origin_kind='inspection_draft' then
  select description into title from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
 elsif item.origin_kind='reception_review' then
  select suggestions->'metadata'->'description'->>'value' into title from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 else title:='Item I-'||upper(left(p_item::text,8));end if;
 body:=jsonb_build_object('uuid',pid,'name',left(coalesce(nullif(title,''),'Item I-'||upper(left(p_item::text,8))),120),'externalReference','komisio:'||p_item,'vatPercentage',vat,'variants',jsonb_build_array(jsonb_build_object('uuid',vid,'sku','K-'||p_item,'barcode','I-'||upper(left(p_item::text,8)),'price',jsonb_build_object('amount',price.price_ore,'currencyId',komisio_private.store_currency(p_tenant)))));
 select e.payload into previous from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=p_item order by o.created_at desc limit 1;
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by) values(p_tenant,p_item,price.id,cfg.id,policy_id,pid,vid,body,previous,uid) returning id into result;
 return result;
end $$;

create or replace function public.economy_summary(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p_start timestamptz; p_end timestamptz; totals jsonb; days jsonb; liability record; open_payouts record;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
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
