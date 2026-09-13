-- P2 staged kinds: agents may propose a return (medium), a ledger adjustment
-- (high) and a batch of due markdowns (low). Same recipe as before: private
-- validate, preflight and execute per kind, one case line per dispatcher.
-- Execution runs the ordinary engine function as the approving person, so an
-- adjustment approved by staff fails at execution exactly as it would by hand.
alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check check(kind in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch'));

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
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

create function komisio_private.op_validate_record_return(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['saleLineId','refundOre','reason']) or (value-array['saleLineId','refundOre','reason'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'saleLineId')<>'string' or (value->>'saleLineId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'refundOre')<>'number' or (value->>'refundOre') !~ '^[1-9][0-9]{0,10}$' then return false; end if;
 if jsonb_typeof(value->'reason')<>'string' or length(trim(value->>'reason')) not between 1 and 500 then return false; end if;
 return true;
end $$;
create function komisio_private.op_preflight_record_return(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line public.sale_lines; sale public.sales;
begin
 select * into line from public.sale_lines where tenant_id=p_tenant and id=(p_payload->>'saleLineId')::uuid;
 if not found then raise exception 'SALE_LINE_NOT_FOUND'; end if;
 select * into sale from public.sales where tenant_id=p_tenant and id=line.sale_id;
 if sale.status<>'completed' then raise exception 'SALE_NOT_COMPLETED'; end if;
 if exists(select 1 from public.sale_returns where tenant_id=p_tenant and sale_line_id=line.id) then raise exception 'LINE_ALREADY_RETURNED'; end if;
 if (p_payload->>'refundOre')::bigint<>line.price_ore then raise exception 'PARTIAL_REFUND_UNSUPPORTED'; end if;
 return jsonb_build_object('sale_line_id',line.id,'item_id',line.item_id);
end $$;
create function komisio_private.op_execute_record_return(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.record_return(p_tenant,p_operation,(p_payload->>'saleLineId')::uuid,(p_payload->>'refundOre')::bigint,p_payload->>'reason',now());
end $$;

create function komisio_private.op_validate_adjust_ledger(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['sellerId','amountOre','reason']) or (value-array['sellerId','amountOre','reason'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'sellerId')<>'string' or (value->>'sellerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'amountOre')<>'number' or (value->>'amountOre') !~ '^-?[1-9][0-9]{0,10}$' then return false; end if;
 if jsonb_typeof(value->'reason')<>'string' or length(trim(value->>'reason')) not between 1 and 500 then return false; end if;
 return true;
end $$;
create function komisio_private.op_preflight_adjust_ledger(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=(p_payload->>'sellerId')::uuid) then raise exception 'SELLER_NOT_FOUND'; end if;
 return jsonb_build_object('seller_id',p_payload->>'sellerId','amount_ore',(p_payload->>'amountOre')::bigint);
end $$;
create function komisio_private.op_execute_adjust_ledger(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.adjust_seller_ledger(p_tenant,p_operation,(p_payload->>'sellerId')::uuid,(p_payload->>'amountOre')::bigint,p_payload->>'reason');
end $$;

create function komisio_private.op_validate_apply_markdown_batch(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; seen uuid[]:='{}'; iid uuid;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['items']) or (value-array['items'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'items')<>'array' or jsonb_array_length(value->'items') not between 1 and 50 then return false; end if;
 for entry in select * from jsonb_array_elements(value->'items') loop
  if jsonb_typeof(entry)<>'object' or not(entry ?& array['itemId','step']) or (entry-array['itemId','step'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(entry->'itemId')<>'string' or (entry->>'itemId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(entry->'step')<>'number' or (entry->>'step') !~ '^[1-9][0-9]?$' then return false; end if;
  iid:=(entry->>'itemId')::uuid;
  if iid=any(seen) then return false; end if;
  seen:=array_append(seen,iid);
 end loop;
 return true;
end $$;
-- Every item's proposed step must be the due step right now; otherwise the batch is refused whole.
create function komisio_private.op_preflight_apply_markdown_batch(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; f jsonb; n integer:=0;
begin
 for entry in select * from jsonb_array_elements(p_payload->'items') loop
  f:=komisio_private.item_lifecycle(p_tenant,(entry->>'itemId')::uuid);
  if (f->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
  if (f->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
  if (f->>'dueStep')::integer is distinct from (entry->>'step')::integer then raise exception 'MARKDOWN_NOT_DUE'; end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('items',n);
end $$;
create function komisio_private.op_execute_apply_markdown_batch(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
 -- One event per item; the batch's own identity is the operation. All or nothing inside the approving transaction.
 for entry in select * from jsonb_array_elements(p_payload->'items') loop
  perform public.apply_markdown(p_tenant,gen_random_uuid(),(entry->>'itemId')::uuid,(entry->>'step')::integer);
 end loop;
 return p_operation;
end $$;
revoke all on function komisio_private.op_validate_record_return(jsonb),komisio_private.op_preflight_record_return(uuid,jsonb),komisio_private.op_execute_record_return(uuid,uuid,jsonb),
 komisio_private.op_validate_adjust_ledger(jsonb),komisio_private.op_preflight_adjust_ledger(uuid,jsonb),komisio_private.op_execute_adjust_ledger(uuid,uuid,jsonb),
 komisio_private.op_validate_apply_markdown_batch(jsonb),komisio_private.op_preflight_apply_markdown_batch(uuid,jsonb),komisio_private.op_execute_apply_markdown_batch(uuid,uuid,jsonb) from public,anon,authenticated;

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
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch'))
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
