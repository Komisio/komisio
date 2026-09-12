-- S0: per-kind dispatch for staged operations. Behaviour is unchanged; the
-- kind-specific bodies move into private preflight/execute functions so that
-- adding a kind adds functions instead of re-declaring the dispatchers.
-- Applied migrations remain immutable; everything here is create-or-replace or new.

-- Risk derives from the kind here and nowhere else.
create function komisio_private.operation_risk(p_kind text) returns text
language plpgsql immutable set search_path='' as $$
begin
 case p_kind
  when 'publishReceptionReview' then return 'low';
  when 'saveInspectionDraft' then return 'low';
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

-- Structural validation per kind (moved bodies, unchanged).
create function komisio_private.op_validate_publish_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])
  or (value-array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'sessionId')<>'string' or (value->>'sessionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'agreementId')<>'string' or (value->>'agreementId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'previousReviewId') not in ('null','string')
  or (jsonb_typeof(value->'previousReviewId')='string' and (value->>'previousReviewId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
 if jsonb_typeof(value->'sourceRevision')<>'number' or (value->>'sourceRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'sourceRevision')::bigint>2147483646 then return false; end if;
 if jsonb_typeof(value->'expiresAt')<>'string' or length(value->>'expiresAt')>40 then return false; end if;
 return komisio_private.valid_reception_review(value->'suggestions');
end $$;

create function komisio_private.op_validate_save_inspection_draft(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['bagId','draftId','expectedRevision','fields']) or (value-array['bagId','draftId','expectedRevision','fields'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'bagId')<>'string' or (value->>'bagId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'draftId')<>'string' or (value->>'draftId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'expectedRevision')<>'number' or (value->>'expectedRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'expectedRevision')::bigint>2147483646 then return false; end if;
 if jsonb_typeof(value->'fields')<>'object' or not((value->'fields') ?& array['description','category','condition']) or ((value->'fields')-array['description','category','condition'])<>'{}'::jsonb then return false; end if;
 return jsonb_typeof(value#>'{fields,description}')='string' and length(trim(value#>>'{fields,description}')) between 1 and 1000
  and jsonb_typeof(value#>'{fields,category}')='string' and length(trim(value#>>'{fields,category}'))<=120
  and jsonb_typeof(value#>'{fields,condition}')='string' and length(trim(value#>>'{fields,condition}'))<=500;
end $$;

create or replace function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 case p_kind
  when 'publishReceptionReview' then return komisio_private.op_validate_publish_reception_review(value);
  when 'saveInspectionDraft' then return komisio_private.op_validate_save_inspection_draft(value);
  else return false;
 end case;
end $$;

-- Preflight per kind: the same preconditions the engine function enforces, so a
-- stale proposal fails at proposal time. Returns the audit detail for the proposal.
create function komisio_private.op_preflight_publish_reception_review(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; rev integer; prev uuid; agr uuid; review_expiry timestamptz; src public.reception_source_revisions; latest public.reception_reviews; current_agreement uuid; fact jsonb; ref text;
begin
 sid:=(p_payload->>'sessionId')::uuid; rev:=(p_payload->>'sourceRevision')::integer; prev:=(p_payload->>'previousReviewId')::uuid; agr:=(p_payload->>'agreementId')::uuid;
 begin review_expiry:=(p_payload->>'expiresAt')::timestamptz; exception when others then raise exception 'INVALID_INPUT'; end;
 if not exists(select 1 from public.reception_sessions where id=sid and tenant_id=p_tenant) then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into src from public.reception_source_revisions where session_id=sid order by revision desc limit 1;
 if not found or src.revision<>rev then raise exception 'RECEPTION_CHANGED'; end if;
 select * into latest from public.reception_reviews where session_id=sid order by version desc limit 1;
 if latest.id is distinct from prev then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_agreement is distinct from agr then raise exception 'AGREEMENT_CHANGED'; end if;
 if not isfinite(review_expiry) or review_expiry<=now() or review_expiry>now()+interval '7 days' then raise exception 'RECEPTION_REVIEW_EXPIRED'; end if;
 for fact in select v from jsonb_each(p_payload->'suggestions'->'metadata') as fields(k,v) loop
  for ref in select * from jsonb_array_elements_text(fact->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
 end loop;
 for ref in select * from jsonb_array_elements_text(p_payload->'suggestions'->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 return jsonb_build_object('session_id',sid);
end $$;

create function komisio_private.op_preflight_save_inspection_draft(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare draft public.inspection_draft_revisions;
begin
 select * into draft from public.inspection_draft_revisions where tenant_id=p_tenant and bag_id=(p_payload->>'bagId')::uuid and draft_id=(p_payload->>'draftId')::uuid order by revision desc limit 1;
 if not found then raise exception 'INSPECTION_NOT_FOUND'; end if;
 if draft.archived then raise exception 'INSPECTION_ARCHIVED'; end if;
 if draft.revision<>(p_payload->>'expectedRevision')::integer then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
 if draft.description=trim(p_payload#>>'{fields,description}') and draft.category=trim(p_payload#>>'{fields,category}') and draft.condition=trim(p_payload#>>'{fields,condition}') then raise exception 'INSPECTION_UNCHANGED'; end if;
 return jsonb_build_object('bag_id',p_payload->>'bagId','draft_id',p_payload->>'draftId');
end $$;

-- Execute per kind: calls the ordinary engine function as the approver.
create function komisio_private.op_execute_publish_reception_review(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.publish_reception_review(p_tenant,p_operation,(p_payload->>'sessionId')::uuid,(p_payload->>'sourceRevision')::integer,
  (p_payload->>'previousReviewId')::uuid,(p_payload->>'agreementId')::uuid,p_payload->'suggestions',(p_payload->>'expiresAt')::timestamptz);
end $$;

create function komisio_private.op_execute_save_inspection_draft(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.save_inspection_draft(p_tenant,p_operation,(p_payload->>'bagId')::uuid,(p_payload->>'draftId')::uuid,
  (p_payload->>'expectedRevision')::integer,p_payload#>>'{fields,description}',p_payload#>>'{fields,category}',p_payload#>>'{fields,condition}');
end $$;

-- Dispatchers. Adding a kind: one line in operation_risk, one in
-- valid_operation_payload, one in each dispatcher below, plus the four
-- private functions for the kind.
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

revoke all on function
 komisio_private.operation_risk(text),
 komisio_private.op_validate_publish_reception_review(jsonb),
 komisio_private.op_validate_save_inspection_draft(jsonb),
 komisio_private.valid_operation_payload(text,jsonb),
 komisio_private.op_preflight_publish_reception_review(uuid,jsonb),
 komisio_private.op_preflight_save_inspection_draft(uuid,jsonb),
 komisio_private.op_execute_publish_reception_review(uuid,uuid,jsonb),
 komisio_private.op_execute_save_inspection_draft(uuid,uuid,jsonb)
from public,anon,authenticated;
revoke all on function public.propose_operation(uuid,uuid,text,jsonb,text,timestamptz),public.decide_operation(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.propose_operation(uuid,uuid,text,jsonb,text,timestamptz),public.decide_operation(uuid,uuid,uuid,text,text) to authenticated;
