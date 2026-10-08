create or replace function public.complete_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer,p_web_calls integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid; attempt public.seller_ai_attempts; prior public.seller_ai_results; reserved public.ai_credit_events; actual bigint; low numeric; high numeric; chosen jsonb; fact text; ext jsonb; src jsonb; source_amount numeric; minimum numeric; maximum numeric;
begin
 perform komisio_private.require_seller_ai_server();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 select * into attempt from public.seller_ai_attempts where id=p_id and tenant_id=p_tenant and seller_id=p_seller and created_by=uid;
 if not found then raise exception 'FORBIDDEN'; end if;
 if p_output is not null then
  p_output:=p_output-'indicativePrice';
  chosen:=coalesce(nullif(p_output->'price','null'),nullif(p_output->'externalComparison','null'),nullif(p_output->'approximatePrice','null'));
  if chosen->>'from' ~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' and chosen->>'to' ~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' then
   p_output:=p_output||jsonb_build_object('indicativePrice', least((chosen->>'to')::numeric,greatest((chosen->>'from')::numeric,round(((chosen->>'from')::numeric+(chosen->>'to')::numeric)/2)))::numeric(12,2)::text);
  end if;
  if p_output ? 'itemFacts' then
   if jsonb_typeof(p_output->'itemFacts') is distinct from 'object' or not(p_output->'itemFacts' ?& array['category','brand','model','articleNumber','material','size','condition']) or (p_output->'itemFacts')-array['category','brand','model','articleNumber','material','size','condition']<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
   foreach fact in array array['category','brand','model','articleNumber','material','size','condition'] loop
    if p_output->'itemFacts'->fact<>'null'::jsonb and (jsonb_typeof(p_output->'itemFacts'->fact) is distinct from 'string' or length(trim(p_output->'itemFacts'->>fact)) not between 1 and 100) then raise exception 'INVALID_INPUT'; end if;
   end loop;
  end if;
 end if;
 select * into prior from public.seller_ai_results where id=p_id;
 if found then if prior.output is distinct from p_output then raise exception 'REQUEST_CONFLICT'; end if; return; end if;
 if p_input is null or p_output_tokens is null or p_input not between 0 and 10000000 or p_output_tokens not between 0 and 10000000 then raise exception 'INVALID_INPUT'; end if;
 if p_web_calls is null or p_web_calls not between 0 and 4 or (p_web_calls>0 and not(attempt.context ? 'webRateOre')) then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null then
  if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['description','price','suitability','reason']) or p_output-array['description','price','suitability','reason','externalComparison','approximatePrice','itemFacts','indicativePrice']<>'{}'::jsonb
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

