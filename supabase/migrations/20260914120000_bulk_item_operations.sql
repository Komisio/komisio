-- P2 S20 bulk staged operations. First the missing single-item command: a
-- manual price set by staff (reason required, item on sale, replay by event
-- id). Then one staged kind, bulkItemUpdate, that applies a price change or an
-- end of period to up to 50 items as one proposal: preflight refuses the whole
-- set if any item is sold or ended, execution applies every item inside the
-- approving transaction, all or nothing. Medium risk: a second person approves.
create function public.set_item_price(p_tenant uuid,p_id uuid,p_item uuid,p_price_ore bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_reason,'')); f jsonb;
begin
 if p_price_ore is null or p_price_ore<1 or p_price_ore>99999999999 or length(note) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'price_set',jsonb_build_object('priceOre',p_price_ore,'reason',note)) then return p_id; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,p_item,p_price_ore,'manual',uid);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_tenant,p_item,'price_set',jsonb_build_object('priceOre',p_price_ore,'reason',note,'previousPriceOre',(f->>'currentPriceOre')::bigint),uid);
 perform komisio_private.record_access(p_tenant,'item.price_set',p_item,jsonb_build_object('price_ore',p_price_ore));
 return p_id;
end $$;
revoke all on function public.set_item_price(uuid,uuid,uuid,bigint,text) from public,anon;
grant execute on function public.set_item_price(uuid,uuid,uuid,bigint,text) to authenticated;

alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check check(kind in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate'));

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
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

create function komisio_private.op_validate_bulk_item_update(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; seen uuid[]:='{}'; iid uuid; act text; keys text[];
begin
 if value is null or jsonb_typeof(value)<>'object' or jsonb_typeof(value->'action')<>'string' then return false; end if;
 act:=value->>'action';
 if act='setPrice' then keys:=array['action','items','reason'];
 elsif act='endPeriod' then keys:=array['action','items','endAction','note'];
 else return false; end if;
 if not(value ?& keys) or (value-keys)<>'{}'::jsonb then return false; end if;
 if act='setPrice' and (jsonb_typeof(value->'reason')<>'string' or length(trim(value->>'reason')) not between 1 and 500) then return false; end if;
 if act='endPeriod' and (jsonb_typeof(value->'endAction')<>'string' or value->>'endAction' not in ('charity','return')
  or jsonb_typeof(value->'note')<>'string' or length(value->>'note')>500) then return false; end if;
 if jsonb_typeof(value->'items')<>'array' or jsonb_array_length(value->'items') not between 1 and 50 then return false; end if;
 for entry in select * from jsonb_array_elements(value->'items') loop
  if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'itemId')<>'string' or (entry->>'itemId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if act='setPrice' then
   if not(entry ?& array['itemId','priceOre']) or (entry-array['itemId','priceOre'])<>'{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'priceOre')<>'number' or (entry->>'priceOre') !~ '^[1-9][0-9]{0,10}$' then return false; end if;
  elsif (entry-array['itemId'])<>'{}'::jsonb then return false; end if;
  iid:=(entry->>'itemId')::uuid;
  if iid=any(seen) then return false; end if;
  seen:=array_append(seen,iid);
 end loop;
 return true;
end $$;
create function komisio_private.op_preflight_bulk_item_update(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; f jsonb; n integer:=0;
begin
 for entry in select * from jsonb_array_elements(p_payload->'items') loop
  f:=komisio_private.item_lifecycle(p_tenant,(entry->>'itemId')::uuid);
  if (f->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
  if (f->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('action',p_payload->>'action','items',n);
end $$;
create function komisio_private.op_execute_bulk_item_update(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
 for entry in select * from jsonb_array_elements(p_payload->'items') loop
  if p_payload->>'action'='setPrice' then
   perform public.set_item_price(p_tenant,gen_random_uuid(),(entry->>'itemId')::uuid,(entry->>'priceOre')::bigint,p_payload->>'reason');
  else
   perform public.end_sale_period(p_tenant,gen_random_uuid(),(entry->>'itemId')::uuid,p_payload->>'endAction',p_payload->>'note');
  end if;
 end loop;
 return p_operation;
end $$;
revoke all on function komisio_private.op_validate_bulk_item_update(jsonb),komisio_private.op_preflight_bulk_item_update(uuid,jsonb),komisio_private.op_execute_bulk_item_update(uuid,uuid,jsonb) from public,anon,authenticated;

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
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate'))
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
