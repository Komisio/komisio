-- S12 whole-purchase proposal, medium risk; no new automatic execution scope.
alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check check(kind in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase'));

create or replace function komisio_private.operation_risk(p_kind text) returns text
language plpgsql immutable set search_path='' as $$
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
  else raise exception 'INVALID_INPUT';
 end case;
end $$;


create function komisio_private.op_validate_zettle_purchase(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return p is not null and jsonb_typeof(p)='object' and p ?& array['importId','mappingRevision'] and (p-array['importId','mappingRevision'])='{}'::jsonb
  and jsonb_typeof(p->'importId')='string' and (p->>'importId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and jsonb_typeof(p->'mappingRevision')='number' and (p->>'mappingRevision') ~ '^[0-9]{1,9}$';
end $$;
create function komisio_private.ready_zettle_purchase(p_tenant uuid,p_import uuid,p_revision integer) returns jsonb
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
 if not komisio_private.valid_sale_lines(lines) or total<>receipt.amount_ore or receipt.currency<>'SEK' then raise exception 'INVALID_INPUT';end if;
 return jsonb_build_object('externalId',receipt.external_id,'occurredAt',receipt.occurred_at,'lines',lines,'amountOre',receipt.amount_ore);
end $$;
create function komisio_private.op_preflight_zettle_purchase(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;line jsonb;
begin
 receipt:=komisio_private.ready_zettle_purchase(p_tenant,(p_payload->>'importId')::uuid,(p_payload->>'mappingRevision')::integer);
 if not exists(select 1 from public.sales where tenant_id=p_tenant and provider='zettle' and external_id=receipt->>'externalId') then
  for line in select * from jsonb_array_elements(receipt->'lines') loop
   perform komisio_private.sale_line_facts(p_tenant,(line->>'itemId')::uuid,(line->>'priceOre')::bigint,public.current_store_policy(p_tenant)->'policy');
  end loop;
 end if;
 return jsonb_build_object('import_id',p_payload->>'importId','lines',jsonb_array_length(receipt->'lines'));
end $$;
create function komisio_private.op_execute_zettle_purchase(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
 receipt:=komisio_private.ready_zettle_purchase(p_tenant,(p_payload->>'importId')::uuid,(p_payload->>'mappingRevision')::integer);
 return public.record_sale(p_tenant,p_operation,'zettle',receipt->>'externalId',(receipt->>'occurredAt')::timestamptz,'SEK',receipt->'lines',jsonb_build_object('zettleImportId',p_payload->>'importId'));
end $$;
revoke all on function komisio_private.op_validate_zettle_purchase(jsonb),komisio_private.ready_zettle_purchase(uuid,uuid,integer),komisio_private.op_preflight_zettle_purchase(uuid,jsonb),komisio_private.op_execute_zettle_purchase(uuid,uuid,jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
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
  else return false;
 end case;
end $$;

create or replace function public.propose_operation(p_tenant uuid,p_id uuid,p_kind text,p_payload jsonb,p_actor_label text,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
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
  else raise exception 'INVALID_INPUT';
 end case;
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,risk,p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label)||detail);
 return p_id;
end $$;

create or replace function public.decide_operation(p_tenant uuid,p_id uuid,p_operation uuid,p_decision text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
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
end $$;

create or replace function public.operation_queue_filtered_page(p_tenant uuid,p_status text,p_before_created timestamptz,p_before_id uuid,p_kind text)
returns table(id uuid,kind text,risk_level text,actor_kind text,actor_label text,proposed_by uuid,payload jsonb,expires_at timestamptz,created_at timestamptz,
 status text,decision_id uuid,outcome text,result_id uuid,error_code text,reason text,decided_by uuid,decided_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase'))
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
end $$;
