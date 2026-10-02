-- Store-scoped language for future proposals; historical policies and facts are unchanged.
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota','automaticSellerNotifications','automaticMarkdowns','currency','intakeProfile','itemLanguage'];
 if not(value ?& allowed) or (value-allowed-optional)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
 if value ? 'currency' and (jsonb_typeof(value->'currency')<>'string' or value->>'currency' not in ('SEK','NOK','DKK','EUR')) then return false; end if;
 if value ? 'itemLanguage' and (jsonb_typeof(value->'itemLanguage')<>'string' or value->>'itemLanguage' not in ('sv','en','no','dk','fi','de','es','it')) then return false; end if;
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


create or replace function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $body$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz; s public.platform_settings; est bigint; p text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_revision is null or p_revision<1
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$'
  or (p_prompt is null or p_prompt not in ('reception-v1','reception-v2','reception-v3','reception-v4','reception-batch-v1','reception-batch-v2','reception-batch-v3','reception-batch-v4') and p_prompt !~ '^reception(-batch)?-v5-(sv|en|no|dk|fi|de|es|it)$') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_assistance_attempts where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.source_revision is distinct from p_revision
   or prior.created_by is distinct from uid or prior.model is distinct from p_model or prior.prompt_version is distinct from p_prompt then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 select revision into latest from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if latest is distinct from p_revision then raise exception 'RECEPTION_CHANGED'; end if;
 moment:=clock_timestamp();
 if exists(select 1 from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '20 seconds')
  or (select count(*) from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
 values(p_request,p_tenant,p_session,p_revision,uid,p_model,p_prompt,moment);
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections c where c.tenant_id=p_tenant) then
  p:=komisio_private.usage_period(moment);
  est:=case when p_prompt like 'reception-batch-%' then s.ai_reserve_batch_ore else s.ai_reserve_ore end;
  perform komisio_private.ai_grant_included(p_tenant);

  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,p);

  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED' using errcode='55000'; end if;

  if fund='included' and komisio_private.ai_cap_used(p)+est>s.ai_monthly_cap_ore then

   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED' using errcode='55000'; end if;

  end if;

  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,p,'attempt:'||p_request,p_model,uid);

 end if;

 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));

 return true;

end $body$;
