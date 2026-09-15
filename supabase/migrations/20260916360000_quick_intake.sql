-- Quick reception (owner decision 2026-09-15: the default intake profile is
-- "quick"). One call turns a seller's garment into an accepted item by
-- chaining the existing steps in one transaction: a source revision with the
-- staff's price evidence, a review published under the store's current
-- agreement, custody, commercial acceptance. Every step keeps its rules:
-- agreement evidence per the policy, seller approval when the policy asks
-- for it, one item per session. The policy key intakeProfile (quick,
-- standard, full; absent means quick) says whether the store uses it; "full"
-- keeps the step-by-step reception only.
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
 if value ? 'currency' and (jsonb_typeof(value->'currency')<>'string' or value->>'currency' not in ('SEK','NOK','DKK','EUR')) then return false; end if;
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

create function public.quick_receive(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; metadata jsonb:='{}'::jsonb; k text; v text; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_seller is null or p_expected is null or p_expected<0 or p_expected>=2147483646
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999 or p_facts is null or jsonb_typeof(p_facts)<>'object' or not (p_facts ? 'description') then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 if coalesce(pol->>'intakeProfile','quick')='full' then raise exception 'INTAKE_PROFILE_FULL'; end if;
 select * into sess from public.reception_sessions where tenant_id=p_tenant and id=p_session;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 if sess.seller_id<>p_seller then raise exception 'RECEPTION_SESSION_SELLER'; end if;
 select * into existing from public.items where tenant_id=p_tenant and origin_kind='reception_review' and origin_id=p_session;
 if found then
  -- The same garment again (a retried request): the item already exists.
  select id into garment_id from public.garment_receipts where tenant_id=p_tenant and session_id=p_session;
  return jsonb_build_object('itemId',existing.id,'reference','I-'||upper(left(existing.id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',existing.origin_revision);
 end if;
 select * into src from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if coalesce(src.revision,0)<>p_expected then raise exception 'RECEPTION_CHANGED'; end if;
 for k in select * from jsonb_object_keys(p_facts) loop
  if k not in ('description','category','color','brand','size','material','condition') or jsonb_typeof(p_facts->k)<>'string' then raise exception 'INVALID_INPUT'; end if;
 end loop;
 price_source:=md5(p_request::text||':price')::uuid;
 sources:=coalesce(src.sources,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',price_source::text,'kind','price-evidence','reference','Staff','observation','Quick reception: price set by staff'));
 perform public.save_reception_sources(p_tenant,md5(p_request::text||':sources')::uuid,p_session,p_expected,sources);
 select value->>'id' into photo_source from jsonb_array_elements(sources) value where value->>'kind'='photo' limit 1;
 for k in select * from jsonb_object_keys(p_facts) loop
  v:=trim(p_facts->>k);
  if v='' then continue; end if;
  if length(v)>1000 then raise exception 'INVALID_INPUT'; end if;
  metadata:=metadata||jsonb_build_object(k,jsonb_build_object('value',v,'sourceIds',jsonb_build_array(coalesce(photo_source,price_source::text)),'certainty','observed'));
 end loop;
 if not (metadata ? 'description') then raise exception 'INVALID_INPUT'; end if;
 suggestions:=jsonb_build_object('metadata',metadata,
  'price',jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'amount',to_char(p_price_ore/100.0,'FM999999990.00'),'rationale','Set by staff at quick reception','sourceIds',jsonb_build_array(price_source::text)),
  'questions','[]'::jsonb);
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select * into latest_review from public.reception_reviews where tenant_id=p_tenant and session_id=p_session order by version desc limit 1;
 review_id:=public.publish_reception_review(p_tenant,md5(p_request::text||':review')::uuid,p_session,p_expected+1,latest_review.id,agreement,suggestions,now()+interval '1 day');
 select version into review_version from public.reception_reviews where id=review_id;
 garment_id:=public.receive_garment(p_tenant,md5(p_request::text||':garment')::uuid,p_session,'');
 item_id:=public.accept_item(p_tenant,md5(p_request::text||':item')::uuid,'reception_review',p_session,review_version,p_price_ore);
 perform komisio_private.record_access(p_tenant,'item.quick_received',item_id,jsonb_build_object('session_id',p_session,'price_ore',p_price_ore,'photo',photo_source is not null));
 return jsonb_build_object('itemId',item_id,'reference','I-'||upper(left(item_id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',review_version);
end $$;
revoke all on function public.quick_receive(uuid,uuid,uuid,uuid,integer,jsonb,bigint) from public,anon;
grant execute on function public.quick_receive(uuid,uuid,uuid,uuid,integer,jsonb,bigint) to authenticated;
