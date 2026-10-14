-- AI identities are bounded BAS candidates, never an approved posting profile.
create function komisio_private.valid_accounting_suggestion(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; keys text[]:='{}';
begin
 if value is null or jsonb_typeof(value) is distinct from 'object' or not(value ?& array['rows','warnings']) or value-array['rows','warnings']<>'{}'::jsonb or jsonb_typeof(value->'rows') is distinct from 'array' or jsonb_typeof(value->'warnings') is distinct from 'array' then return false; end if;
 if jsonb_array_length(value->'rows')>23 or jsonb_array_length(value->'warnings')>8 then return false; end if;
 for r in select * from jsonb_array_elements(value->'rows') loop
  if jsonb_typeof(r) is distinct from 'object' or not(r ?& array['key','account','side','reason']) or r-array['key','account','side','reason']<>'{}'::jsonb
   or jsonb_typeof(r->'key') is distinct from 'string' or not((r->>'key')=any(komisio_private.accounting_keys())) or (r->>'key')=any(keys)
   or jsonb_typeof(r->'account') is distinct from 'string' or not((r->>'account')=any(array['1686','1910','1930','1940','1990','2890','2899','2611','2616','2621','2626','2631','2636','3001','3002','3003','3004','3211','3212','3921','3999']))
   or jsonb_typeof(r->'side') is distinct from 'string' or r->>'side' not in ('debit','credit')
   or jsonb_typeof(r->'reason') is distinct from 'string' or length(trim(r->>'reason')) not between 1 and 350 then return false; end if;
  keys:=array_append(keys,r->>'key');
 end loop;
 if exists(select 1 from jsonb_array_elements(value->'warnings') w where jsonb_typeof(w) is distinct from 'string' or length(trim(w#>>'{}')) not between 1 and 500) then return false; end if;
 return true;
end $$;
revoke all on function komisio_private.valid_accounting_suggestion(jsonb) from public,anon,authenticated;

-- AI accounting drafting: no account map publication or export occurs here.
create table public.accounting_ai_attempts (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 model text not null, prompt_version text not null check(prompt_version='accounting-v1'),
 context jsonb not null, unique(tenant_id,id)
);
create table public.accounting_ai_results (
 id uuid primary key, tenant_id uuid not null, output jsonb,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,id) references public.accounting_ai_attempts(tenant_id,id)
);
alter table public.accounting_ai_attempts enable row level security;
alter table public.accounting_ai_results enable row level security;
revoke all on public.accounting_ai_attempts,public.accounting_ai_results from public,anon,authenticated;
grant select on public.accounting_ai_attempts,public.accounting_ai_results to authenticated;
create policy accounting_ai_attempts_read on public.accounting_ai_attempts for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy accounting_ai_results_read on public.accounting_ai_results for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger accounting_ai_attempts_immutable before update or delete on public.accounting_ai_attempts for each row execute function komisio_private.preserve_operation();
create trigger accounting_ai_results_immutable before update or delete on public.accounting_ai_results for each row execute function komisio_private.preserve_operation();
create trigger meter_accounting_assistance after insert on public.accounting_ai_attempts for each row execute function komisio_private.meter_usage('reception_assistance');

create function public.begin_accounting_assistance(p_tenant uuid,p_id uuid,p_base uuid,p_language text,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.accounting_ai_attempts; pol jsonb; agr uuid; snapshot jsonb; result public.accounting_ai_results;
 s public.platform_settings; est bigint; period text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 if p_id is null or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.accounting_ai_attempts where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.model<>p_model or prior.context->>'language'<>p_language or (prior.context->>'mapId')::uuid is distinct from p_base then raise exception 'REQUEST_CONFLICT'; end if;
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

create function komisio_private.op_validate_use_accounting_draft(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='object' and value ? 'draftId' and value-'draftId'='{}'::jsonb and value->>'draftId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
$$;
create function komisio_private.op_preflight_use_accounting_draft(p_tenant uuid,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare attempt public.accounting_ai_attempts; agr uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 select a.* into attempt from public.accounting_ai_attempts a join public.accounting_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id where a.id=(p_payload->>'draftId')::uuid and a.tenant_id=p_tenant and r.output is not null;
 if not found then raise exception 'INVALID_INPUT'; end if;
 return '{}'::jsonb;
end $$;
create function komisio_private.op_execute_use_accounting_draft(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare attempt public.accounting_ai_attempts; agr uuid;
begin
 perform komisio_private.op_preflight_use_accounting_draft(p_tenant,p_payload);
 select * into attempt from public.accounting_ai_attempts where tenant_id=p_tenant and id=(p_payload->>'draftId')::uuid;
 select id into agr from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 if agr is distinct from (attempt.context->>'mapId')::uuid then raise exception 'MAP_CHANGED'; end if;
 if public.current_store_policy(p_tenant)->'id' is distinct from attempt.context->'policyId' then raise exception 'REQUEST_CONFLICT'; end if;
 return (p_payload->>'draftId')::uuid;
end $$;

create function public.complete_accounting_assistance(p_tenant uuid,p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer) returns void
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
 if p_output is not null and not komisio_private.valid_accounting_suggestion(p_output) then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null and exists(select 1 from jsonb_array_elements(p_output->'rows') r where (attempt.context->'currentMap') ? (r->>'key')) then raise exception 'INVALID_INPUT'; end if;
 perform public.settle_reception_assistance(p_tenant,p_id,p_input,p_output_tokens);
 insert into public.accounting_ai_results(id,tenant_id,output) values(p_id,p_tenant,p_output);
 if p_output is not null then
  perform public.propose_operation(p_tenant,p_id,'useAccountingDraft',jsonb_build_object('draftId',p_id),'Accounting AI',now()+interval '7 days');
 end if;
end $$;
revoke all on function public.begin_accounting_assistance(uuid,uuid,uuid,text,text),public.complete_accounting_assistance(uuid,uuid,jsonb,integer,integer) from public,anon;
grant execute on function public.begin_accounting_assistance(uuid,uuid,uuid,text,text),public.complete_accounting_assistance(uuid,uuid,jsonb,integer,integer) to authenticated;
revoke all on function komisio_private.op_validate_use_accounting_draft(jsonb),komisio_private.op_preflight_use_accounting_draft(uuid,jsonb),komisio_private.op_execute_use_accounting_draft(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION komisio_private.operation_risk(p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 case p_kind
  when 'publishReceptionReview' then return 'low';
  when 'saveInspectionDraft' then return 'low';
  when 'acceptItem' then return 'medium';
  when 'recordReturn' then return 'medium';
  when 'adjustLedger' then return 'high';
  when 'applyMarkdownBatch' then return 'low';
  when 'bulkItemUpdate' then return 'medium';
  when 'approvePayout' then return 'medium';
  when 'markPayoutPaid' then return 'medium';
  when 'sendMessage' then return 'low';
  when 'exportDayClose' then return 'medium';
  when 'recordZettlePurchase' then return 'medium';
  when 'settlePayouts' then return 'medium';
  when 'updateStoreProfile' then return 'low';
  when 'importSellers' then return 'low';
  when 'useAgreementDraft' then return 'low';
  when 'useAccountingDraft' then return 'low';
  else raise exception 'INVALID_INPUT';
 end case;
end $function$
;
CREATE OR REPLACE FUNCTION komisio_private.valid_operation_payload(p_kind text, value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 case p_kind
  when 'publishReceptionReview' then return komisio_private.op_validate_publish_reception_review(value);
  when 'saveInspectionDraft' then return komisio_private.op_validate_save_inspection_draft(value);
  when 'acceptItem' then return komisio_private.op_validate_accept_item(value);
  when 'recordReturn' then return komisio_private.op_validate_record_return(value);
  when 'adjustLedger' then return komisio_private.op_validate_adjust_ledger(value);
  when 'applyMarkdownBatch' then return komisio_private.op_validate_apply_markdown_batch(value);
  when 'bulkItemUpdate' then return komisio_private.op_validate_bulk_item_update(value);
  when 'approvePayout' then return komisio_private.op_validate_approve_payout(value);
  when 'markPayoutPaid' then return komisio_private.op_validate_mark_payout_paid(value);
  when 'sendMessage' then return komisio_private.op_validate_send_message(value);
  when 'exportDayClose' then return komisio_private.op_validate_export_day_close(value);
  when 'recordZettlePurchase' then return komisio_private.op_validate_zettle_purchase(value);
  when 'settlePayouts' then return komisio_private.op_validate_settle_payouts(value);
  when 'updateStoreProfile' then return komisio_private.op_validate_update_store_profile(value);
  when 'useAgreementDraft' then return komisio_private.op_validate_use_agreement_draft(value);
  when 'useAccountingDraft' then return komisio_private.op_validate_use_accounting_draft(value);
  when 'importSellers' then return komisio_private.op_validate_import_sellers(value);
  else return false;
 end case;
end $function$
;
CREATE OR REPLACE FUNCTION public.propose_operation(p_tenant uuid, p_id uuid, p_kind text, p_payload jsonb, p_actor_label text, p_expires timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); prior public.pending_operations; label text:=trim(p_actor_label); risk text; detail jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_kind is null or label is null or length(label) not between 1 and 100
  or p_expires is null or not isfinite(p_expires) or not komisio_private.valid_operation_payload(p_kind,p_payload) then raise exception 'INVALID_INPUT'; end if;
 risk:=komisio_private.operation_risk(p_kind);
 select * into prior from public.pending_operations where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.kind is distinct from p_kind or prior.payload is distinct from p_payload
   or prior.proposed_by is distinct from uid or prior.actor_label is distinct from label or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
 case p_kind
  when 'publishReceptionReview' then detail:=komisio_private.op_preflight_publish_reception_review(p_tenant,p_payload);
  when 'saveInspectionDraft' then detail:=komisio_private.op_preflight_save_inspection_draft(p_tenant,p_payload);
  when 'acceptItem' then detail:=komisio_private.op_preflight_accept_item(p_tenant,p_payload);
  when 'recordReturn' then detail:=komisio_private.op_preflight_record_return(p_tenant,p_payload);
  when 'adjustLedger' then detail:=komisio_private.op_preflight_adjust_ledger(p_tenant,p_payload);
  when 'applyMarkdownBatch' then detail:=komisio_private.op_preflight_apply_markdown_batch(p_tenant,p_payload);
  when 'bulkItemUpdate' then detail:=komisio_private.op_preflight_bulk_item_update(p_tenant,p_payload);
  when 'approvePayout' then detail:=komisio_private.op_preflight_payout(p_tenant,p_payload,'requested');
  when 'markPayoutPaid' then detail:=komisio_private.op_preflight_payout(p_tenant,p_payload,'approved');
  when 'sendMessage' then detail:=komisio_private.op_preflight_send_message(p_tenant,p_payload);
  when 'exportDayClose' then detail:=komisio_private.op_preflight_export_day_close(p_tenant,p_payload);
  when 'recordZettlePurchase' then detail:=komisio_private.op_preflight_zettle_purchase(p_tenant,p_payload);
  when 'settlePayouts' then detail:=komisio_private.op_preflight_settle_payouts(p_tenant,p_payload);
  when 'updateStoreProfile' then detail:=komisio_private.op_preflight_update_store_profile(p_tenant,p_payload);
  when 'useAgreementDraft' then detail:=komisio_private.op_preflight_use_agreement_draft(p_tenant,p_payload);
  when 'useAccountingDraft' then detail:=komisio_private.op_preflight_use_accounting_draft(p_tenant,p_payload);
  when 'importSellers' then detail:=komisio_private.op_preflight_import_sellers(p_tenant,p_payload);
  else raise exception 'INVALID_INPUT';
 end case;
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,risk,p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label)||detail);
 return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.decide_operation(p_tenant uuid, p_id uuid, p_operation uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); prior public.operation_decisions; op public.pending_operations; note text:=coalesce(trim(p_reason),''); result uuid; failure text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_operation is null or p_decision is null or p_decision not in ('approved','rejected') or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.operation_decisions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.operation_id is distinct from p_operation or prior.decision is distinct from p_decision
   or prior.decided_by is distinct from uid or prior.reason is distinct from note then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into op from public.pending_operations where id=p_operation and tenant_id=p_tenant;
 if not found then raise exception 'OPERATION_NOT_FOUND'; end if;
 if exists(select 1 from public.operation_decisions where operation_id=p_operation) then raise exception 'OPERATION_DECIDED'; end if;
 if p_decision='rejected' then
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,reason,decided_by) values(p_id,p_tenant,p_operation,'rejected','rejected',note,uid);
  perform komisio_private.record_access(p_tenant,'operation.decided',p_operation,jsonb_build_object('decision','rejected','outcome','rejected'));
  return p_id;
 end if;
 if op.expires_at<=now() then raise exception 'OPERATION_EXPIRED'; end if;
 -- Only low-risk kinds may be approved by the same person whose session proposed them.
 if op.risk_level<>'low' and op.proposed_by=uid then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 begin
  case op.kind
   when 'publishReceptionReview' then result:=komisio_private.op_execute_publish_reception_review(p_tenant,p_operation,op.payload);
   when 'saveInspectionDraft' then result:=komisio_private.op_execute_save_inspection_draft(p_tenant,p_operation,op.payload);
   when 'acceptItem' then result:=komisio_private.op_execute_accept_item(p_tenant,p_operation,op.payload);
   when 'recordReturn' then result:=komisio_private.op_execute_record_return(p_tenant,p_operation,op.payload);
   when 'adjustLedger' then result:=komisio_private.op_execute_adjust_ledger(p_tenant,p_operation,op.payload);
   when 'applyMarkdownBatch' then result:=komisio_private.op_execute_apply_markdown_batch(p_tenant,p_operation,op.payload);
   when 'bulkItemUpdate' then result:=komisio_private.op_execute_bulk_item_update(p_tenant,p_operation,op.payload);
   when 'approvePayout' then result:=komisio_private.op_execute_approve_payout(p_tenant,p_operation,op.payload);
   when 'markPayoutPaid' then result:=komisio_private.op_execute_mark_payout_paid(p_tenant,p_operation,op.payload);
   when 'sendMessage' then result:=komisio_private.op_execute_send_message(p_tenant,p_operation,op.payload);
   when 'exportDayClose' then result:=komisio_private.op_execute_export_day_close(p_tenant,p_operation,op.payload);
   when 'recordZettlePurchase' then result:=komisio_private.op_execute_zettle_purchase(p_tenant,p_operation,op.payload);
   when 'settlePayouts' then result:=komisio_private.op_execute_settle_payouts(p_tenant,p_operation,op.payload);
   when 'updateStoreProfile' then result:=komisio_private.op_execute_update_store_profile(p_tenant,p_operation,op.payload);
   when 'useAgreementDraft' then result:=komisio_private.op_execute_use_agreement_draft(p_tenant,p_operation,op.payload);
   when 'useAccountingDraft' then result:=komisio_private.op_execute_use_accounting_draft(p_tenant,p_operation,op.payload);
   when 'importSellers' then result:=komisio_private.op_execute_import_sellers(p_tenant,p_operation,op.payload);
   else raise exception 'INVALID_INPUT';
  end case;
 exception when others then
  failure:=left(sqlerrm,100);
 end;
 if failure is null then
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,result_id,reason,decided_by) values(p_id,p_tenant,p_operation,'approved','executed',result,note,uid);
 else
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,error_code,reason,decided_by) values(p_id,p_tenant,p_operation,'approved','failed',failure,note,uid);
 end if;
 perform komisio_private.record_access(p_tenant,'operation.decided',p_operation,jsonb_build_object('decision','approved','outcome',case when failure is null then 'executed' else 'failed' end,'error',coalesce(failure,'')));
 return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.operation_queue_filtered_page(p_tenant uuid, p_status text, p_before_created timestamp with time zone, p_before_id uuid, p_kind text)
 RETURNS TABLE(id uuid, kind text, risk_level text, actor_kind text, actor_label text, proposed_by uuid, payload jsonb, expires_at timestamp with time zone, created_at timestamp with time zone, status text, decision_id uuid, outcome text, result_id uuid, error_code text, reason text, decided_by uuid, decided_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts','updateStoreProfile','importSellers','useAgreementDraft','useAccountingDraft'))
  or p_status is null or p_status not in ('all','open','expired','executed','failed','rejected')
  or (p_before_created is null)<>(p_before_id is null)
  or (p_before_created is not null and not isfinite(p_before_created)) then raise exception 'INVALID_INPUT'; end if;
 return query
 select o.id,o.kind,o.risk_level,o.actor_kind,o.actor_label,o.proposed_by,o.payload,o.expires_at,o.created_at,
  case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end,
  d.id,d.outcome,d.result_id,d.error_code,d.reason,d.decided_by,d.created_at
 from public.pending_operations o left join public.operation_decisions d on d.operation_id=o.id
 where o.tenant_id=p_tenant
  and (p_kind is null or o.kind=p_kind)
  and (p_before_created is null or (o.created_at,o.id)<(p_before_created,p_before_id))
  and (p_status='all' or (case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end)=p_status)
 order by o.created_at desc,o.id desc limit 21;
end $function$
;
alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check CHECK ((kind = ANY (ARRAY['publishReceptionReview'::text, 'saveInspectionDraft'::text, 'acceptItem'::text, 'recordReturn'::text, 'adjustLedger'::text, 'applyMarkdownBatch'::text, 'bulkItemUpdate'::text, 'approvePayout'::text, 'markPayoutPaid'::text, 'sendMessage'::text, 'exportDayClose'::text, 'recordZettlePurchase'::text, 'settlePayouts'::text, 'updateStoreProfile'::text, 'importSellers'::text, 'useAgreementDraft'::text, 'useAccountingDraft'::text])));
