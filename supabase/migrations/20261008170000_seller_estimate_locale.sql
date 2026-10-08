-- Additive advisory output; preserve existing immutable results and grants.
drop function public.begin_seller_photo_assistance(uuid,uuid,uuid,jsonb,text,integer);
create function public.begin_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_photos jsonb,p_model text,p_web_rate integer default null,p_language text default null) returns jsonb
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
create or replace function public.complete_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer,p_web_calls integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid; attempt public.seller_ai_attempts; prior public.seller_ai_results; reserved public.ai_credit_events; actual bigint; low numeric; high numeric; ext jsonb; src jsonb; source_amount numeric; minimum numeric; maximum numeric;
begin
 perform komisio_private.require_seller_ai_server();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 select * into attempt from public.seller_ai_attempts where id=p_id and tenant_id=p_tenant and seller_id=p_seller and created_by=uid;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into prior from public.seller_ai_results where id=p_id;
 if found then if prior.output is distinct from p_output then raise exception 'REQUEST_CONFLICT'; end if; return; end if;
 if p_input is null or p_output_tokens is null or p_input not between 0 and 10000000 or p_output_tokens not between 0 and 10000000 then raise exception 'INVALID_INPUT'; end if;
 if p_web_calls is null or p_web_calls not between 0 and 4 or (p_web_calls>0 and not(attempt.context ? 'webRateOre')) then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null then
  if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['description','price','suitability','reason']) or p_output-array['description','price','suitability','reason','externalComparison','approximatePrice']<>'{}'::jsonb
   or jsonb_typeof(p_output->'description') is distinct from 'string' or length(trim(p_output->>'description')) not between 1 and 2000
   or jsonb_typeof(p_output->'reason') is distinct from 'string' or length(trim(p_output->>'reason')) not between 1 and 300
   or coalesce(p_output->>'suitability','') not in ('likely','uncertain','unlikely') then raise exception 'INVALID_INPUT'; end if;
  if trim(attempt.context->>'accepts')='' and trim(attempt.context->>'concept')='' and attempt.context->'goods'='[]'::jsonb and p_output->>'suitability'<>'uncertain' then raise exception 'INVALID_INPUT'; end if;
  if p_output ? 'approximatePrice' and p_output->'approximatePrice'<>'null'::jsonb then
   ext:=p_output->'approximatePrice';
   if jsonb_typeof(ext) is distinct from 'object' or not(ext ?& array['from','to','basis']) or ext-array['from','to','basis']<>'{}'::jsonb
    or ext->>'basis' is distinct from 'ai_estimate'
    or jsonb_typeof(ext->'from') is distinct from 'string' or jsonb_typeof(ext->'to') is distinct from 'string'
    or coalesce(ext->>'from','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' or coalesce(ext->>'to','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
   low:=(ext->>'from')::numeric; high:=(ext->>'to')::numeric;
   if low<=0 or high<low then raise exception 'INVALID_INPUT'; end if;
  end if;
  if p_output ? 'externalComparison' then
   ext:=p_output->'externalComparison';
   if attempt.context->>'country' is distinct from 'SE' or attempt.context->>'currency' is distinct from 'SEK' or not(attempt.context ? 'webRateOre') or p_web_calls=0
    or jsonb_typeof(ext) is distinct from 'object' or not(ext ?& array['from','to','basis','observedAt','sources'])
    or ext-array['from','to','basis','observedAt','sources']<>'{}'::jsonb
    or coalesce(ext->>'basis','') not in ('asking','sold')
    or jsonb_typeof(ext->'observedAt') is distinct from 'string' or coalesce(ext->>'observedAt','') !~ '^\d{4}-\d{2}-\d{2}T' or jsonb_typeof(ext->'sources') is distinct from 'array'
    or coalesce(ext->>'from','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' or coalesce(ext->>'to','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$'
    or jsonb_typeof(ext->'from') is distinct from 'string' or jsonb_typeof(ext->'to') is distinct from 'string'
    then raise exception 'INVALID_INPUT'; end if;
   low:=(ext->>'from')::numeric; high:=(ext->>'to')::numeric;
   if low<=0 or high<low or jsonb_array_length(ext->'sources') not between 2 and 3
    or (select count(distinct x->>'url') from jsonb_array_elements(ext->'sources') x)<>jsonb_array_length(ext->'sources')
    or (ext->>'observedAt')::timestamptz<attempt.created_at or (ext->>'observedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    then raise exception 'INVALID_INPUT'; end if;
   for src in select value from jsonb_array_elements(ext->'sources') loop
    if jsonb_typeof(src) is distinct from 'object' or not(src ?& array['url','title','amount','condition','status','soldAt','country','currency','priceBasis'])
     or src-array['url','title','amount','condition','status','soldAt','country','currency','priceBasis']<>'{}'::jsonb
     or coalesce(src->>'url','') !~ '^https://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/[^[:space:]]*$'
     or length(src->>'url')>2000 or jsonb_typeof(src->'title') is distinct from 'string' or length(trim(src->>'title')) not between 1 and 160
     or jsonb_typeof(src->'condition') is distinct from 'string' or length(trim(src->>'condition')) not between 1 and 300
     or src->>'country' is distinct from 'SE' or src->>'currency' is distinct from 'SEK' or src->>'priceBasis' is distinct from 'item_only'
     or src->>'status' is distinct from ext->>'basis' or jsonb_typeof(src->'amount') is distinct from 'string'
     or coalesce(src->>'amount','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
    source_amount:=(src->>'amount')::numeric;
    if source_amount<=0 then raise exception 'INVALID_INPUT'; end if;
    minimum:=least(minimum,source_amount); maximum:=greatest(maximum,source_amount);
    if src->>'status'='sold' and (src->>'soldAt' is null or (src->>'soldAt')::timestamptz<clock_timestamp()-interval '365 days' or (src->>'soldAt')::timestamptz>clock_timestamp()) then raise exception 'INVALID_INPUT'; end if;
   end loop;
   if low<minimum or high>maximum then raise exception 'INVALID_INPUT'; end if;
  end if;
  if p_output->'price'<>'null'::jsonb then
   if jsonb_typeof(p_output->'price') is distinct from 'object' or not(p_output->'price' ?& array['from','to','evidenceIds']) or (p_output->'price')-array['from','to','evidenceIds']<>'{}'::jsonb
    or jsonb_typeof(p_output->'price'->'from') is distinct from 'string' or jsonb_typeof(p_output->'price'->'to') is distinct from 'string'
    or coalesce(p_output->'price'->>'from','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' or coalesce(p_output->'price'->>'to','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$'
    or jsonb_typeof(p_output->'price'->'evidenceIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
   low:=(p_output->'price'->>'from')::numeric;high:=(p_output->'price'->>'to')::numeric;
   if low<=0 or high<low or jsonb_array_length(p_output->'price'->'evidenceIds') not between 1 and 20 or exists(select 1 from jsonb_array_elements_text(p_output->'price'->'evidenceIds') e where not exists(select 1 from jsonb_array_elements(attempt.context->'evidence') x where x->>'id'=e)) then raise exception 'INVALID_INPUT'; end if;
  end if;
 end if;
 select * into reserved from public.ai_credit_events where tenant_id=p_tenant and reference='seller-photo:'||p_id and kind='reserved';
 if found then
  actual:=komisio_private.ai_cost_ore(p_input,p_output_tokens)+p_web_calls*coalesce((attempt.context->>'webRateOre')::integer,0);
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,input_tokens,output_tokens,recorded_by) values(p_tenant,'settled',-reserved.amount_ore-actual,reserved.funded_by,reserved.period,reserved.reference,reserved.model,p_input,p_output_tokens,uid);
 end if;
 insert into public.seller_ai_results(id,tenant_id,output,web_calls) values(p_id,p_tenant,p_output,p_web_calls);
 perform komisio_private.record_access(p_tenant,'seller_submission.assistance_completed',p_id,jsonb_build_object('ready',p_output is not null));
end $$;

revoke all on function public.begin_seller_photo_assistance(uuid,uuid,uuid,jsonb,text,integer,text) from public,anon;
grant execute on function public.begin_seller_photo_assistance(uuid,uuid,uuid,jsonb,text,integer,text) to authenticated;
