-- Reuse immutable, actor-owned accounting drafts, metering and staged editor use.
alter table public.accounting_ai_attempts drop constraint accounting_ai_attempts_prompt_version_check;
alter table public.accounting_ai_attempts add constraint accounting_ai_attempts_prompt_version_check check(prompt_version in ('accounting-v1','economic-accounts-v1'));

create function komisio_private.valid_economic_ai_accounts(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare row jsonb; seen text[]:='{}';
begin
 if value is null or jsonb_typeof(value) is distinct from 'array' then return false; end if;
 if jsonb_array_length(value) not between 1 and 1000 then return false; end if;
 for row in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(row) is distinct from 'object' or not(row ?& array['account','name','type']) or row-array['account','name','type']<>'{}'::jsonb
   or jsonb_typeof(row->'account') is distinct from 'string' or row->>'account' !~ '^[1-9][0-9]{0,9}$'
   or jsonb_typeof(row->'name') is distinct from 'string' or length(row->>'name')>200
   or row->>'type' not in ('profitAndLoss','status') or jsonb_typeof(row->'type') is distinct from 'string'
   or row->>'account'=any(seen) then return false; end if;
  if (row->>'account')::bigint>2147483647 then return false; end if;
  seen:=array_append(seen,row->>'account');
 end loop;
 return true;
end $$;
revoke all on function komisio_private.valid_economic_ai_accounts(jsonb) from public,anon,authenticated;


create or replace function komisio_private.valid_economic_accounting_suggestion(value jsonb,accounts jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; keys text[]:='{}';
begin
 if value is null or jsonb_typeof(value) is distinct from 'object' or not(value ?& array['rows','warnings']) or value-array['rows','warnings']<>'{}'::jsonb or jsonb_typeof(value->'rows') is distinct from 'array' or jsonb_typeof(value->'warnings') is distinct from 'array' then return false; end if;
 if jsonb_array_length(value->'rows')>cardinality(komisio_private.accounting_keys()) or jsonb_array_length(value->'warnings')>8 then return false; end if;
 for r in select * from jsonb_array_elements(value->'rows') loop
  if jsonb_typeof(r) is distinct from 'object' or not(r ?& array['key','account','side','reason']) or r-array['key','account','side','reason']<>'{}'::jsonb
   or jsonb_typeof(r->'key') is distinct from 'string' or not((r->>'key')=any(komisio_private.accounting_keys())) or (r->>'key')=any(keys)
   or jsonb_typeof(r->'account') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(accounts) a where a->>'account'=r->>'account')
   or jsonb_typeof(r->'side') is distinct from 'string' or r->>'side' not in ('debit','credit')
   or jsonb_typeof(r->'reason') is distinct from 'string' or length(trim(r->>'reason')) not between 1 and 350 then return false; end if;
  keys:=array_append(keys,r->>'key');
 end loop;
 if exists(select 1 from jsonb_array_elements(value->'warnings') w where jsonb_typeof(w) is distinct from 'string' or length(trim(w#>>'{}')) not between 1 and 500) then return false; end if;
 return true;
end $$;

create or replace function public.begin_accounting_assistance(p_tenant uuid,p_id uuid,p_base uuid,p_language text,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.accounting_ai_attempts; pol jsonb; agr uuid; snapshot jsonb; result public.accounting_ai_results;
 s public.platform_settings; est bigint; period text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 if p_id is null or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.accounting_ai_attempts where id=p_id;
 if found then
  if prior.prompt_version<>'accounting-v1' or prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.model<>p_model or prior.context->>'language'<>p_language or (prior.context->>'mapId')::uuid is distinct from p_base then raise exception 'REQUEST_CONFLICT'; end if;
  select * into result from public.accounting_ai_results where id=p_id;
  return jsonb_build_object('reserved',false,'status',case when not found then 'pending' when result.output is null then 'failed' else 'ready' end,'output',result.output,'context',prior.context);
 end if;
 if exists(select 1 from public.agreement_ai_attempts where id=p_id) or exists(select 1 from public.ai_credit_events where reference='attempt:'||p_id) or exists(select 1 from public.reception_assistance_attempts where id=p_id) or exists(select 1 from public.pending_operations where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 select id into agr from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 if agr is distinct from p_base then raise exception 'MAP_CHANGED'; end if;
 pol:=public.current_store_policy(p_tenant);
 if pol->'policy'->>'assistanceEnabled'='false' then raise exception 'ASSISTANCE_DISABLED'; end if;
 if exists(select 1 from public.accounting_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '20 seconds') or (select count(*) from public.accounting_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 snapshot:=jsonb_build_object('policyId',pol->'id','mapId',p_base,'language',p_language,
  'policy',(select jsonb_object_agg(key,value) from jsonb_each(pol->'policy') where key=any(array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','commissionBasis','currency','consignmentPeriod'])),
  'currentMap',public.current_accounting_map(p_tenant)->'map','availableKeys',to_jsonb(komisio_private.accounting_keys()),'catalogVersion','BAS-2026-v1.1');
 insert into public.accounting_ai_attempts(id,tenant_id,created_by,model,prompt_version,context) values(p_id,p_tenant,uid,p_model,'accounting-v1',snapshot);
 perform 1 from public.platform_settings for update;
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then
  period:=komisio_private.usage_period(clock_timestamp()); est:=s.ai_reserve_batch_ore;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,period);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED'; end if;
  if fund='included' and komisio_private.ai_cap_used(period)+est>s.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,period,'attempt:'||p_id,p_model,uid);
 end if;
 return jsonb_build_object('reserved',true,'status','pending','output',null,'context',snapshot);
end $$;

create or replace function public.begin_economic_accounting_assistance(p_tenant uuid,p_id uuid,p_base uuid,p_language text,p_model text,p_agreement integer,p_revision uuid,p_accounts jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.accounting_ai_attempts; pol jsonb; agr uuid; snapshot jsonb; result public.accounting_ai_results;
 s public.platform_settings; connection public.economic_connections; est bigint; period text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 if p_id is null or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.accounting_ai_attempts where id=p_id;
 if found then
  if prior.prompt_version<>'economic-accounts-v1' or (prior.context->>'agreementNumber')::integer is distinct from p_agreement or prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.model<>p_model or prior.context->>'language'<>p_language or (prior.context->>'mapId')::uuid is distinct from p_base then raise exception 'REQUEST_CONFLICT'; end if;
  select * into result from public.accounting_ai_results where id=p_id;
  return jsonb_build_object('reserved',false,'status',case when not found then 'pending' when result.output is null then 'failed' else 'ready' end,'output',result.output,'context',prior.context);
 end if;
 if exists(select 1 from public.agreement_ai_attempts where id=p_id) or exists(select 1 from public.ai_credit_events where reference='attempt:'||p_id) or exists(select 1 from public.reception_assistance_attempts where id=p_id) or exists(select 1 from public.pending_operations where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 select id into agr from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 if agr is distinct from p_base then raise exception 'MAP_CHANGED'; end if;

 select * into connection from public.economic_connections where tenant_id=p_tenant;
 if not found then raise exception 'ECONOMIC_NOT_CONNECTED'; end if;
 if connection.agreement_number is distinct from p_agreement or connection.revision is distinct from p_revision then raise exception 'REQUEST_CONFLICT'; end if;
 if komisio_private.store_currency(p_tenant)<>'DKK' then raise exception 'ECONOMIC_CURRENCY_UNSUPPORTED'; end if;
 if not komisio_private.valid_economic_ai_accounts(p_accounts) then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant);
 if pol->'policy'->>'assistanceEnabled'='false' then raise exception 'ASSISTANCE_DISABLED'; end if;
 if exists(select 1 from public.accounting_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '20 seconds') or (select count(*) from public.accounting_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 snapshot:=jsonb_build_object('policyId',pol->'id','mapId',p_base,'language',p_language,
  'policy',(select jsonb_object_agg(key,value) from jsonb_each(pol->'policy') where key=any(array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','commissionBasis','currency','consignmentPeriod'])),
  'currentMap',public.current_economic_map(p_tenant)->'map','availableKeys',to_jsonb(komisio_private.accounting_keys()),'destination','economic','agreementNumber',p_agreement,'connectionRevision',p_revision,'accounts',p_accounts);
 insert into public.accounting_ai_attempts(id,tenant_id,created_by,model,prompt_version,context) values(p_id,p_tenant,uid,p_model,'economic-accounts-v1',snapshot);
 perform 1 from public.platform_settings for update;
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then
  period:=komisio_private.usage_period(clock_timestamp()); est:=s.ai_reserve_batch_ore;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,period);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED'; end if;
  if fund='included' and komisio_private.ai_cap_used(period)+est>s.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,period,'attempt:'||p_id,p_model,uid);
 end if;
 return jsonb_build_object('reserved',true,'status','pending','output',null,'context',snapshot);
end $$;

create or replace function public.complete_accounting_assistance(p_tenant uuid,p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer) returns void
language plpgsql security definer set search_path='' as $$
declare attempt public.accounting_ai_attempts; previous public.accounting_ai_results;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 select * into attempt from public.accounting_ai_attempts where tenant_id=p_tenant and id=p_id and created_by=komisio_private.require_identity();
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into previous from public.accounting_ai_results where id=p_id;
 if found then
  if previous.output is distinct from p_output then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 if p_output is not null and not (case when attempt.prompt_version='economic-accounts-v1' then komisio_private.valid_economic_accounting_suggestion(p_output,attempt.context->'accounts') else komisio_private.valid_accounting_suggestion(p_output) end) then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null and exists(select 1 from jsonb_array_elements(p_output->'rows') r where (attempt.context->'currentMap') ? (r->>'key')) then raise exception 'INVALID_INPUT'; end if;
 perform public.settle_reception_assistance(p_tenant,p_id,p_input,p_output_tokens);
 insert into public.accounting_ai_results(id,tenant_id,output) values(p_id,p_tenant,p_output);
 if p_output is not null then
  perform public.propose_operation(p_tenant,p_id,'useAccountingDraft',jsonb_build_object('draftId',p_id)||(case when attempt.prompt_version='economic-accounts-v1' then '{"destination":"economic"}'::jsonb else '{}'::jsonb end),'Accounting AI',now()+interval '7 days');
 end if;
end $$;

create or replace function komisio_private.op_validate_use_accounting_draft(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='object' and value ? 'draftId' and value-array['draftId','destination']='{}'::jsonb and value->>'draftId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and (not(value ? 'destination') or value->>'destination'='economic'),false)
$$;

create or replace function komisio_private.op_execute_use_accounting_draft(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare attempt public.accounting_ai_attempts; agr uuid; connection public.economic_connections;
begin
 perform komisio_private.op_preflight_use_accounting_draft(p_tenant,p_payload);
 select * into attempt from public.accounting_ai_attempts where tenant_id=p_tenant and id=(p_payload->>'draftId')::uuid;

 if attempt.prompt_version='economic-accounts-v1' then
  if attempt.created_by<>komisio_private.require_identity() or p_payload->>'destination' is distinct from 'economic' then raise exception 'FORBIDDEN'; end if;
  select * into connection from public.economic_connections where tenant_id=p_tenant;
  if not found or connection.revision is distinct from (attempt.context->>'connectionRevision')::uuid or connection.agreement_number is distinct from (attempt.context->>'agreementNumber')::integer then raise exception 'REQUEST_CONFLICT'; end if;
  select id into agr from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 else
  if p_payload ? 'destination' then raise exception 'REQUEST_CONFLICT'; end if;
  select id into agr from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 end if;
 if agr is distinct from (attempt.context->>'mapId')::uuid then raise exception 'MAP_CHANGED'; end if;
 if public.current_store_policy(p_tenant)->'id' is distinct from attempt.context->'policyId' then raise exception 'REQUEST_CONFLICT'; end if;
 return (p_payload->>'draftId')::uuid;
end $$;

revoke all on function komisio_private.valid_economic_accounting_suggestion(jsonb,jsonb) from public,anon,authenticated;

revoke all on function public.begin_economic_accounting_assistance(uuid,uuid,uuid,text,text,integer,uuid,jsonb) from public,anon;

grant execute on function public.begin_economic_accounting_assistance(uuid,uuid,uuid,text,text,integer,uuid,jsonb) to authenticated;
