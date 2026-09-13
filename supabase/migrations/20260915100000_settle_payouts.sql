-- P3 settlement: one batch requests and approves a payout for every listed
-- seller, all or nothing, as the person running it. Candidates are the sellers
-- whose available balance reaches the policy threshold and who have no open
-- payout. The batch is a record for replay and audit; the money moves only
-- through the existing payout transitions, so each payout in the batch is an
-- ordinary approved payout awaiting payment by the manual rail. The staged
-- kind settlePayouts (medium) lets an agent propose the same batch for a
-- second person to approve.
create table public.payout_batches (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 sellers jsonb not null,
 reason text not null check(length(reason) between 1 and 500),
 payout_count integer not null check(payout_count between 1 and 100),
 total_ore bigint not null check(total_ore>0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index payout_batches_tenant on public.payout_batches(tenant_id,created_at desc,id);
alter table public.payout_batches enable row level security;
revoke all on public.payout_batches from public,anon,authenticated;
grant select on public.payout_batches to authenticated;
create policy payout_batches_read on public.payout_batches for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create trigger payout_batches_immutable before update or delete on public.payout_batches for each row execute function komisio_private.preserve_payout_event();

-- Shape shared by the command and the staged kind: each seller once, integer
-- öre, at most 100 rows.
create function komisio_private.valid_settlement_sellers(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; n integer:=0;
begin
 if value is null or jsonb_typeof(value)<>'array' or jsonb_array_length(value) not between 1 and 100 then return false; end if;
 for r in select * from jsonb_array_elements(value) loop
  n:=n+1;
  if jsonb_typeof(r)<>'object' or not(r ?& array['sellerId','amountOre']) or (r-array['sellerId','amountOre'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(r->'sellerId')<>'string' or (r->>'sellerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(r->'amountOre')<>'number' or (r->>'amountOre') !~ '^[1-9][0-9]{0,10}$' then return false; end if;
 end loop;
 if (select count(distinct e->>'sellerId') from jsonb_array_elements(value) e)<>n then return false; end if;
 return true;
end $$;
revoke all on function komisio_private.valid_settlement_sellers(jsonb) from public,anon,authenticated;

-- The preconditions every row must meet, checked before anything is written
-- and again inside the payout functions; returns the batch total.
create function komisio_private.check_settlement(p_tenant uuid,p_sellers jsonb) returns bigint
language plpgsql stable security definer set search_path='' as $$
declare r jsonb; seller uuid; amount bigint; threshold bigint:=komisio_private.payout_threshold_ore(p_tenant); total bigint:=0;
begin
 for r in select * from jsonb_array_elements(p_sellers) loop
  seller:=(r->>'sellerId')::uuid; amount:=(r->>'amountOre')::bigint;
  if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=seller) then raise exception 'SELLER_NOT_FOUND'; end if;
  if exists(select 1 from public.payouts where tenant_id=p_tenant and seller_id=seller and status in ('requested','approved')) then raise exception 'PAYOUT_PENDING'; end if;
  if amount<threshold then raise exception 'PAYOUT_BELOW_THRESHOLD'; end if;
  if amount>komisio_private.available_ore(p_tenant,seller) then raise exception 'PAYOUT_EXCEEDS_BALANCE'; end if;
  total:=total+amount;
 end loop;
 return total;
end $$;
revoke all on function komisio_private.check_settlement(uuid,jsonb) from public,anon,authenticated;

-- Sellers a settlement would cover right now: available at or above the
-- threshold and no open payout. Names for the staff page; agents drop them.
create function public.settlement_candidates(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare threshold bigint; rows jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 threshold:=komisio_private.payout_threshold_ore(p_tenant);
 select coalesce(jsonb_agg(jsonb_build_object('sellerId',x.id,'name',x.name,'availableOre',x.available) order by x.name,x.id),'[]') into rows
 from (
  select s.id,s.name,komisio_private.available_ore(p_tenant,s.id) available
  from public.sellers s
  where s.tenant_id=p_tenant
   and not exists(select 1 from public.payouts p where p.tenant_id=p_tenant and p.seller_id=s.id and p.status in ('requested','approved'))
 ) x where x.available>=threshold and x.available>0;
 return jsonb_build_object('thresholdOre',threshold,'sellers',rows);
end $$;
revoke all on function public.settlement_candidates(uuid) from public,anon;
grant execute on function public.settlement_candidates(uuid) to authenticated;

-- The batch: request and approve one payout per seller, in the given order,
-- as the caller. Payout and event ids derive from the batch id and the seller,
-- so a replay of the batch finds its own rows and a partial failure rolls
-- everything back.
create function public.settle_payouts(p_tenant uuid,p_id uuid,p_sellers jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.payout_batches; note text:=trim(coalesce(p_reason,'')); r jsonb; seller uuid; payout uuid; total bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or length(note) not between 1 and 500 or not komisio_private.valid_settlement_sellers(p_sellers) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.payout_batches where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.sellers is distinct from p_sellers or prior.reason is distinct from note or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 total:=komisio_private.check_settlement(p_tenant,p_sellers);
 for r in select * from jsonb_array_elements(p_sellers) loop
  seller:=(r->>'sellerId')::uuid;
  payout:=md5(p_id::text||':'||seller::text)::uuid;
  perform komisio_private.request_payout_core(p_tenant,payout,seller,(r->>'amountOre')::bigint,'staff');
  perform komisio_private.transition_payout(p_tenant,md5(p_id::text||':'||seller::text||':approved')::uuid,payout,'approved',note,'');
 end loop;
 insert into public.payout_batches(id,tenant_id,sellers,reason,payout_count,total_ore,created_by) values(p_id,p_tenant,p_sellers,note,jsonb_array_length(p_sellers),total,uid);
 perform komisio_private.record_access(p_tenant,'payout.batch',p_id,jsonb_build_object('payouts',jsonb_array_length(p_sellers),'total_ore',total));
 return p_id;
end $$;
revoke all on function public.settle_payouts(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.settle_payouts(uuid,uuid,jsonb,text) to authenticated;

-- Staged kind settlePayouts (medium): the same batch proposed by an agent.
alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check check(kind in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts'));

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
  when 'settlePayouts' then return 'medium';
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

create function komisio_private.op_validate_settle_payouts(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['sellers','reason']) or (value-array['sellers','reason'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'reason')<>'string' or length(trim(value->>'reason')) not between 1 and 500 then return false; end if;
 return komisio_private.valid_settlement_sellers(value->'sellers');
end $$;
create function komisio_private.op_preflight_settle_payouts(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total bigint;
begin
 total:=komisio_private.check_settlement(p_tenant,p_payload->'sellers');
 return jsonb_build_object('payouts',jsonb_array_length(p_payload->'sellers'),'total_ore',total);
end $$;
create function komisio_private.op_execute_settle_payouts(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.settle_payouts(p_tenant,p_operation,p_payload->'sellers',p_payload->>'reason');
end $$;
revoke all on function komisio_private.op_validate_settle_payouts(jsonb),komisio_private.op_preflight_settle_payouts(uuid,jsonb),komisio_private.op_execute_settle_payouts(uuid,uuid,jsonb) from public,anon,authenticated;

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
  when 'settlePayouts' then return komisio_private.op_validate_settle_payouts(value);
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
  when 'settlePayouts' then detail:=komisio_private.op_preflight_settle_payouts(p_tenant,p_payload);
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
   when 'settlePayouts' then result:=komisio_private.op_execute_settle_payouts(p_tenant,p_operation,op.payload);
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
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts'))
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
