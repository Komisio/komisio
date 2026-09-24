-- USD support and global country profiles. Existing immutable facts are unchanged.
begin;

create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota','automaticSellerNotifications','automaticMarkdowns','currency','intakeProfile'];
 if not(value ?& allowed) or (value-allowed-optional)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
 if value ? 'currency' and (jsonb_typeof(value->'currency')<>'string' or value->>'currency' not in ('SEK','NOK','DKK','EUR','USD')) then return false; end if;
 if value ? 'intakeProfile' and (jsonb_typeof(value->'intakeProfile')<>'string' or value->>'intakeProfile' not in ('quick','standard','full')) then return false; end if;
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

create or replace function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare price jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 -- metadata is still tolerated on a row written before this migration; it is
 -- never required and never read.
 if not(value ?& array['attributes','price','questions']) or (value-array['attributes','price','questions','itemType','metadata'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 if value ? 'itemType' and (jsonb_typeof(value->'itemType')<>'string' or (value->>'itemType') !~ '^[a-z][a-z0-9_]{0,39}$') then return false; end if;
 if not komisio_private.valid_item_attributes(value->'attributes') then return false; end if;
 if not exists(select 1 from jsonb_array_elements(value->'attributes') a where a->>'slug'='description') then return false; end if;
 -- Publication is where evidence is required: every observation a seller is
 -- asked to approve cites the photo or the note it came from.
 if exists(select 1 from jsonb_array_elements(value->'attributes') a where not komisio_private.valid_reception_refs(a->'sourceIds')) then return false; end if;
 price:=value->'price';
 if jsonb_typeof(price)<>'object' then return false; end if;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR','USD') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;

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
 if p->'blockedReason'='null'::jsonb and (p->>'currency' not in ('SEK','NOK','DKK','EUR','USD') or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 return true;
exception when others then return false;
end $$;

alter table public.sales drop constraint sales_currency_check;
alter table public.sales add constraint sales_currency_check check(currency in ('SEK','NOK','DKK','EUR','USD'));
alter table public.payouts drop constraint payouts_currency_check;
alter table public.payouts add constraint payouts_currency_check check(currency in ('SEK','NOK','DKK','EUR','USD'));
alter table public.purchase_receipts drop constraint purchase_receipts_currency_check;
alter table public.purchase_receipts add constraint purchase_receipts_currency_check check(currency in ('SEK','NOK','DKK','EUR','USD'));

create or replace function komisio_private.valid_store_profile(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare h jsonb; n integer:=0; a jsonb; c jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['address','contact','openingHours','accepts','concept','language']) or (value-array['address','contact','openingHours','accepts','concept','language'])<>'{}'::jsonb then return false; end if;
 a:=value->'address';
 if jsonb_typeof(a)<>'object' or not(a ?& array['street','postalCode','city']) or (a-array['street','postalCode','city','country'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(a->'street')<>'string' or length(a->>'street')>120 or jsonb_typeof(a->'postalCode')<>'string' or length(a->>'postalCode')>20 or jsonb_typeof(a->'city')<>'string' or length(a->>'city')>120 then return false; end if;
 if a ? 'country' and (jsonb_typeof(a->'country') is distinct from 'string' or a->>'country' not in ('AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW')) then return false; end if;
 c:=value->'contact';
 if jsonb_typeof(c)<>'object' or not(c ?& array['email','phone','website']) or (c-array['email','phone','website'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(c->'email')<>'string' or length(c->>'email')>254 or (c->>'email'<>'' and c->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then return false; end if;
 if jsonb_typeof(c->'phone')<>'string' or length(c->>'phone')>40 then return false; end if;
 if jsonb_typeof(c->'website')<>'string' or length(c->>'website')>200 or (c->>'website'<>'' and c->>'website' !~ '^https://[^\s]+$') then return false; end if;
 if jsonb_typeof(value->'openingHours')<>'array' or jsonb_array_length(value->'openingHours')>7 then return false; end if;
 for h in select * from jsonb_array_elements(value->'openingHours') loop
  n:=n+1;
  if jsonb_typeof(h)<>'object' or not(h ?& array['day','opens','closes']) or (h-array['day','opens','closes'])<>'{}'::jsonb then return false; end if;
  if h->>'day' not in ('mon','tue','wed','thu','fri','sat','sun') then return false; end if;
  if jsonb_typeof(h->'opens')<>'string' or (h->>'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(h->'closes')<>'string' or (h->>'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (h->>'opens')>=(h->>'closes') then return false; end if;
 end loop;
 if (select count(distinct e->>'day') from jsonb_array_elements(value->'openingHours') e)<>n then return false; end if;
 if jsonb_typeof(value->'accepts')<>'string' or length(value->>'accepts')>2000 or jsonb_typeof(value->'concept')<>'string' or length(value->>'concept')>2000 then return false; end if;
 if value->>'language' not in ('sv','en','no','dk','fi','de','es','it') then return false; end if;
 return true;
end $$;

create function public.create_tenant_with_currency(p_name text,p_slug text,p_request_id uuid,p_currency text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior uuid; tid uuid; policy jsonb;
begin
 if p_currency is null or p_currency not in ('SEK','NOK','DKK','EUR','USD') or p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select id into prior from public.tenants where created_by=uid and creation_request_id=p_request_id;
 tid:=public.create_tenant(p_name,p_slug,p_request_id);
 if prior is null then
  policy:=(public.current_store_policy(tid)->'policy') || jsonb_build_object('currency',p_currency);
  perform public.publish_store_policy(tid,gen_random_uuid(),null,policy);
 end if;
 return tid;
end $$;
revoke all on function public.create_tenant_with_currency(text,text,uuid,text) from public,anon;
grant execute on function public.create_tenant_with_currency(text,text,uuid,text) to authenticated;

create or replace function public.store_shopify_connection(p_tenant uuid,p_shop_domain text,p_shop_name text,p_currency text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.shopify_connections; replacing boolean; host text:=lower(trim(coalesce(p_shop_domain,'')));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if host !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or length(host)>120 or p_shop_name is null or length(trim(p_shop_name)) not between 1 and 200
  or p_currency is null or length(p_currency)<>3
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or (p_expires_at is not null and not isfinite(p_expires_at)) then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from komisio_private.shopify_sync_settings where tenant_id=p_tenant and shop_domain<>host) then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 select * into existing from public.shopify_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.shop_domain<>host then raise exception 'SHOPIFY_WRONG_SHOP'; end if;
 if upper(p_currency) is distinct from komisio_private.store_currency(p_tenant) then
  perform komisio_private.shopify_event(p_tenant,'refused',jsonb_build_object('reason','CURRENCY_MISMATCH','currency',upper(p_currency),'store_currency',komisio_private.store_currency(p_tenant)),uid);
  return jsonb_build_object('error','CURRENCY_MISMATCH');
 end if;
 perform set_config('komisio.shopify_transition','engine',true);
 if replacing then
  update public.shopify_connections set shop_name=trim(p_shop_name),currency=upper(p_currency),cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now(),revision=nextval('komisio_private.fortnox_connection_revision') where tenant_id=p_tenant;
 else
  insert into public.shopify_connections(tenant_id,shop_domain,shop_name,currency,cipher,scope,expires_at,connected_by)
  values(p_tenant,host,trim(p_shop_name),upper(p_currency),p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('shop_domain',host,'shop_name',trim(p_shop_name)),uid);
 perform komisio_private.record_access(p_tenant,'shopify.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('shop_domain',host));
 return jsonb_build_object('shopDomain',host,'shopName',trim(p_shop_name),'replaced',replacing);
end $$;

commit;
