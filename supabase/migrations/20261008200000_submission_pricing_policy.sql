-- Preserve USD support from the existing global-currencies policy validator.
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota','automaticSellerNotifications','automaticMarkdowns','currency','intakeProfile','itemLanguage','photoSubmissionsEnabled','submissionPricing'];
 if not(value ?& allowed) or (value-allowed-optional)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
 if value ? 'currency' and (jsonb_typeof(value->'currency')<>'string' or value->>'currency' not in ('SEK','NOK','DKK','EUR','USD')) then return false; end if;
 if value ? 'photoSubmissionsEnabled' and jsonb_typeof(value->'photoSubmissionsEnabled')<>'boolean' then return false; end if;
 if value ? 'submissionPricing' and (jsonb_typeof(value->'submissionPricing')<>'string' or value->>'submissionPricing' not in ('store','seller','approval')) then return false; end if;
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



alter table public.seller_submissions
 add column pricing_mode text not null default 'store' check(pricing_mode in ('store','seller','approval')),
 add column seller_price numeric(12,2) check(seller_price>0),
 add column price_currency text;
alter table public.seller_submissions add constraint submission_price_mode check(
 (pricing_mode='store' and seller_price is null) or (pricing_mode in ('seller','approval') and seller_price is not null and price_currency is not null));
alter table public.seller_submission_reviews add column price_approved boolean not null default false;
create function public.my_submission_settings(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pol jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 return jsonb_build_object('enabled',coalesce((pol->>'photoSubmissionsEnabled')::boolean,true),'pricing',coalesce(pol->>'submissionPricing','store'),'currency',komisio_private.store_currency(p_tenant));
end $$;
revoke all on function public.my_submission_settings(uuid,uuid) from public,anon;
grant execute on function public.my_submission_settings(uuid,uuid) to authenticated;
drop function public.submit_my_assisted_items(uuid,uuid,uuid,uuid,text,jsonb,uuid);
create function public.submit_my_assisted_items(p_tenant uuid,p_id uuid,p_seller uuid,p_previous uuid,p_description text,p_photos jsonb,p_assistance uuid,p_price text default null,p_pricing text default 'store',p_currency text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_submissions; path text; d text:=trim(p_description); pol jsonb; mode text; currency text; amount numeric;
begin
 if p_price is not null then
  if p_price !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' then raise exception 'INVALID_INPUT'; end if;
  amount:=p_price::numeric;
  if amount<=0 then raise exception 'INVALID_INPUT'; end if;
 end if;
 if p_assistance is not null and not exists(select 1 from public.seller_ai_attempts a join public.seller_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id where a.id=p_assistance and a.tenant_id=p_tenant and a.seller_id=p_seller and a.photos=p_photos and r.output is not null) then raise exception 'INVALID_INPUT'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or d is null or length(d) not between 1 and 2000 or p_photos is null or jsonb_typeof(p_photos)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_photos) not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string') then raise exception 'INVALID_INPUT'; end if;
 if (select count(distinct x) from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_submissions where id=p_id;
 if found then
  if prior.seller_price is distinct from amount or prior.pricing_mode is distinct from p_pricing or (p_currency is not null and prior.price_currency is distinct from p_currency) or prior.assistance_id is distinct from p_assistance or prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.previous_id is distinct from p_previous or prior.description is distinct from d or prior.photos is distinct from p_photos or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 mode:=coalesce(pol->>'submissionPricing','store'); currency:=komisio_private.store_currency(p_tenant);
 if pol->>'photoSubmissionsEnabled'='false' then raise exception 'SUBMISSIONS_DISABLED'; end if;
 if p_pricing is distinct from mode or (p_currency is not null and p_currency<>currency) then raise exception 'SUBMISSION_CHANGED'; end if;
 if (mode='store' and amount is not null) or (mode<>'store' and (amount is null or p_currency is null)) then raise exception 'INVALID_INPUT'; end if;
 if p_previous is not null and (not exists(select 1 from public.seller_submissions s join public.seller_submission_reviews r on r.submission_id=s.id where s.id=p_previous and s.tenant_id=p_tenant and s.seller_id=p_seller and r.decision='more_information') or exists(select 1 from public.seller_submissions where previous_id=p_previous)) then raise exception 'SUBMISSION_CHANGED'; end if;
 for path in select jsonb_array_elements_text(p_photos) loop
  if path not like p_tenant::text||'/'||p_seller::text||'/%' or not public.seller_submission_photo_access(path,true)
   or not exists(select 1 from storage.objects where bucket_id='seller-submission-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 end loop;
 insert into public.seller_submissions(id,tenant_id,seller_id,previous_id,description,photos,created_by,pricing_mode,seller_price,price_currency,assistance_id,assistance_output)
 values(p_id,p_tenant,p_seller,p_previous,d,p_photos,uid,mode,amount,currency,p_assistance,(select jsonb_build_object('suggestion',r.output,'currency',a.context->>'currency') from public.seller_ai_attempts a join public.seller_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id where a.id=p_assistance));
 perform komisio_private.record_access(p_tenant,'seller_submission.sent',p_id,'{}');
 return p_id;
end $$;

revoke all on function public.submit_my_assisted_items(uuid,uuid,uuid,uuid,text,jsonb,uuid,text,text,text) from public,anon;
grant execute on function public.submit_my_assisted_items(uuid,uuid,uuid,uuid,text,jsonb,uuid,text,text,text) to authenticated;
create or replace function public.submit_my_items(p_tenant uuid,p_id uuid,p_seller uuid,p_previous uuid,p_description text,p_photos jsonb) returns uuid
language sql security definer set search_path='' as $$
 select public.submit_my_assisted_items(p_tenant,p_id,p_seller,p_previous,p_description,p_photos,null);
$$;
create or replace function public.my_item_submissions(p_tenant uuid,p_seller uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into result from (
  select s.id,s.previous_id,s.description,s.photos,s.created_at,r.decision,r.note,s.assistance_output,s.pricing_mode,s.seller_price::text,s.price_currency,r.price_approved
  from public.seller_submissions s left join public.seller_submission_reviews r on r.submission_id=s.id
  where s.tenant_id=p_tenant and s.seller_id=p_seller and (p_before is null or s.created_at<p_before)
  order by s.created_at desc,s.id limit 50
 ) x;
 return result;
end $$;
drop function public.review_seller_submission(uuid,uuid,uuid,text,text);
create function public.review_seller_submission(p_tenant uuid,p_id uuid,p_submission uuid,p_decision text,p_note text,p_price_approved boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_submission_reviews; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_submission is null or p_decision is null or p_decision not in ('invite','more_information','decline') or length(n)>1000 or (p_decision='more_information' and n='') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_submission_reviews where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.submission_id is distinct from p_submission or prior.decision is distinct from p_decision or prior.note is distinct from n or prior.price_approved is distinct from p_price_approved or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.seller_submissions where tenant_id=p_tenant and id=p_submission) then raise exception 'SUBMISSION_NOT_FOUND'; end if;
 if exists(select 1 from public.seller_submission_reviews where submission_id=p_submission) then raise exception 'SUBMISSION_CHANGED'; end if;
 if p_price_approved is null or p_price_approved is distinct from (p_decision='invite' and exists(select 1 from public.seller_submissions where id=p_submission and tenant_id=p_tenant and pricing_mode='approval')) then raise exception 'INVALID_INPUT'; end if;
 insert into public.seller_submission_reviews(id,tenant_id,submission_id,decision,note,created_by,price_approved) values(p_id,p_tenant,p_submission,p_decision,n,uid,p_price_approved);
 perform komisio_private.record_access(p_tenant,'seller_submission.reviewed',p_id,jsonb_build_object('decision',p_decision));
 return p_id;
end $$;
revoke all on function public.review_seller_submission(uuid,uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.review_seller_submission(uuid,uuid,uuid,text,text,boolean) to authenticated;
create or replace function public.seller_submission_photo_access(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare parts text[]; t uuid; s uuid;
begin
 perform komisio_private.require_identity();
 parts:=string_to_array(p_name,'/');
 if array_length(parts,1)<>3 or parts[3] !~ '^[0-9a-f-]{36}\.jpg$' then return false; end if;
 t:=parts[1]::uuid; s:=parts[2]::uuid;
 if not p_write and coalesce(public.tenant_role(t),'') in ('owner','admin','staff','readonly') then if p_write and komisio_private.current_store_policy_core(t)->'policy'->>'photoSubmissionsEnabled'='false' then return false; end if;
 return true; end if;
 perform komisio_private.require_seller(t,s);
 if p_write and komisio_private.current_store_policy_core(t)->'policy'->>'photoSubmissionsEnabled'='false' then return false; end if;
 return true;
exception when others then return false;
end $$;
create or replace function public.begin_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_photos jsonb,p_model text,p_web_rate integer default null,p_language text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_ai_attempts; res public.seller_ai_results; pol jsonb; profile jsonb; goods jsonb; evidence jsonb; snapshot jsonb; path text;
 settings public.platform_settings; period text; est bigint; inc bigint; pur bigint; fund text;
begin
 perform komisio_private.require_seller_ai_server();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_language is not null and p_language not in ('sv','en','no','dk','fi','de','es','it') then raise exception 'INVALID_INPUT'; end if;
 if p_web_rate is not null and p_web_rate not between 0 and 10000 then raise exception 'INVALID_INPUT'; end if;
 if p_id is null or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_photos) not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string') or (select count(distinct x) from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_ai_attempts where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.created_by<>uid or prior.photos<>p_photos or prior.model<>p_model or (p_language is not null and prior.context->>'language' is distinct from p_language) then raise exception 'REQUEST_CONFLICT'; end if;
  select * into res from public.seller_ai_results where id=p_id;
  return jsonb_build_object('reserved',false,'status',case when not found then 'pending' when res.output is null then 'failed' else 'ready' end,'output',res.output,'context',prior.context);
 end if;
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 if pol->>'photoSubmissionsEnabled'='false' then raise exception 'SUBMISSIONS_DISABLED'; end if;
 if pol->>'assistanceEnabled' is distinct from 'true' then raise exception 'ASSISTANCE_DISABLED'; end if;
 if exists(select 1 from public.seller_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '20 seconds') or (select count(*) from public.seller_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')>=100 then raise exception 'ASSISTANCE_LIMIT'; end if;
 for path in select jsonb_array_elements_text(p_photos) loop
  if path not like p_tenant::text||'/'||p_seller::text||'/%' or not public.seller_submission_photo_access(path,true) or not exists(select 1 from storage.objects where bucket_id='seller-submission-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 end loop;
 select v.profile into profile from public.store_profile_versions v where tenant_id=p_tenant order by version desc limit 1;
 select answers->'goods' into goods from public.store_guide_versions where tenant_id=p_tenant order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into evidence from (
  select l.id,komisio_private.item_title(p_tenant,l.item_id) as facts,(l.price_ore::numeric/100)::numeric(12,2)::text as amount,s.occurred_at as sold_at
  from public.sale_lines l join public.sales s on s.id=l.sale_id and s.tenant_id=l.tenant_id
  join public.items i on i.id=l.item_id and i.tenant_id=l.tenant_id
  where l.tenant_id=p_tenant and s.status='completed' and i.ownership='consignment'
   and s.currency=komisio_private.store_currency(p_tenant) and s.occurred_at>=now()-interval '365 days'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id)
  order by s.occurred_at desc,l.id limit 20
 ) x;
 snapshot:=jsonb_build_object('language',coalesce(p_language,pol->>'itemLanguage','sv'),'currency',komisio_private.store_currency(p_tenant),'country',profile->'address'->>'country','accepts',coalesce(profile->>'accepts',''),'concept',coalesce(profile->>'concept',''),'goods',coalesce(goods,'[]'),'evidence',evidence);
 if p_web_rate is not null and snapshot->>'country'='SE' and snapshot->>'currency'='SEK' then
  if p_web_rate=0 and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then raise exception 'INVALID_INPUT'; end if;
  snapshot:=snapshot||jsonb_build_object('webRateOre',p_web_rate);
 end if;
 insert into public.seller_ai_attempts(id,tenant_id,seller_id,photos,context,model,created_by) values(p_id,p_tenant,p_seller,p_photos,snapshot,p_model,uid);
 perform 1 from public.platform_settings for update;
 settings:=komisio_private.ai_settings();
 if settings.ai_credits_enabled and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then
  period:=komisio_private.usage_period(clock_timestamp());est:=settings.ai_reserve_batch_ore+coalesce((snapshot->>'webRateOre')::integer,0)*4;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,period);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED'; end if;
  if fund='included' and komisio_private.ai_cap_used(period)+est>settings.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,period,'seller-photo:'||p_id,p_model,uid);
 end if;
 return jsonb_build_object('reserved',true,'status','pending','output',null,'context',snapshot);
end $$;

-- Reject missing or null provenance dates at the database boundary.
