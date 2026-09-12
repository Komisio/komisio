-- Staged operations: a non-human actor proposes a write, a person decides, and
-- execution reuses the engine function the person could have called directly,
-- running as that person. A proposal is never a fact; a decision is immutable.
create table public.pending_operations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('publishReceptionReview')),
 risk_level text not null check(risk_level in ('low','medium','high')),
 payload jsonb not null,
 actor_kind text not null check(actor_kind in ('agent')),
 actor_label text not null check(length(trim(actor_label)) between 1 and 100),
 proposed_by uuid not null references auth.users(id),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create index pending_operations_tenant on public.pending_operations(tenant_id,created_at desc,id);
create table public.operation_decisions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 operation_id uuid not null unique,
 decision text not null check(decision in ('approved','rejected')),
 outcome text not null check(outcome in ('executed','failed','rejected')),
 result_id uuid,
 error_code text not null default '' check(length(error_code)<=100),
 reason text not null default '' check(length(reason)<=500),
 decided_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,operation_id) references public.pending_operations(tenant_id,id),
 check((decision='rejected')=(outcome='rejected')),
 check((outcome='executed')=(result_id is not null))
);
alter table public.pending_operations enable row level security;
alter table public.operation_decisions enable row level security;
create policy pending_operations_read on public.pending_operations for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy operation_decisions_read on public.operation_decisions for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.pending_operations,public.operation_decisions from public,anon,authenticated;
grant select on public.pending_operations,public.operation_decisions to authenticated;
create function komisio_private.preserve_operation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_OPERATION'; end $$;
create trigger pending_operations_immutable before update or delete on public.pending_operations for each row execute function komisio_private.preserve_operation();
create trigger operation_decisions_immutable before update or delete on public.operation_decisions for each row execute function komisio_private.preserve_operation();

-- Structural payload check per kind. Business preconditions are checked by the
-- proposal function and again by the executing engine function.
create function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if p_kind='publishReceptionReview' then
  if not(value ?& array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])
   or (value-array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(value->'sessionId')<>'string' or (value->>'sessionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'agreementId')<>'string' or (value->>'agreementId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'previousReviewId') not in ('null','string')
   or (jsonb_typeof(value->'previousReviewId')='string' and (value->>'previousReviewId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
  if jsonb_typeof(value->'sourceRevision')<>'number' or (value->>'sourceRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'sourceRevision')::bigint>2147483646 then return false; end if;
  if jsonb_typeof(value->'expiresAt')<>'string' or length(value->>'expiresAt')>40 then return false; end if;
  return komisio_private.valid_reception_review(value->'suggestions');
 end if;
 return false;
end $$;

create function public.propose_operation(p_tenant uuid,p_id uuid,p_kind text,p_payload jsonb,p_actor_label text,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.pending_operations; label text:=trim(p_actor_label);
 sid uuid; rev integer; prev uuid; agr uuid; review_expiry timestamptz; src public.reception_source_revisions; latest public.reception_reviews; current_agreement uuid; fact jsonb; ref text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_kind is null or p_kind not in ('publishReceptionReview') or label is null or length(label) not between 1 and 100
  or p_expires is null or not isfinite(p_expires) or not komisio_private.valid_operation_payload(p_kind,p_payload) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.pending_operations where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.kind is distinct from p_kind or prior.payload is distinct from p_payload
   or prior.proposed_by is distinct from uid or prior.actor_label is distinct from label or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
 -- Preflight the same preconditions the engine function will enforce, so a stale proposal fails at proposal time.
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
 -- Risk is derived from the kind, never supplied by the proposer.
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,'low',p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label,'session_id',sid));
 return p_id;
end $$;

create function public.decide_operation(p_tenant uuid,p_id uuid,p_operation uuid,p_decision text,p_reason text) returns uuid
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
  if op.kind='publishReceptionReview' then
   result:=public.publish_reception_review(p_tenant,p_operation,(op.payload->>'sessionId')::uuid,(op.payload->>'sourceRevision')::integer,
    (op.payload->>'previousReviewId')::uuid,(op.payload->>'agreementId')::uuid,op.payload->'suggestions',(op.payload->>'expiresAt')::timestamptz);
  else
   raise exception 'INVALID_INPUT';
  end if;
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

create function public.operation_queue(p_tenant uuid)
returns table(id uuid,kind text,risk_level text,actor_kind text,actor_label text,proposed_by uuid,payload jsonb,expires_at timestamptz,created_at timestamptz,
 status text,decision_id uuid,outcome text,result_id uuid,error_code text,reason text,decided_by uuid,decided_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return query
 select o.id,o.kind,o.risk_level,o.actor_kind,o.actor_label,o.proposed_by,o.payload,o.expires_at,o.created_at,
  case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end,
  d.id,d.outcome,d.result_id,d.error_code,d.reason,d.decided_by,d.created_at
 from public.pending_operations o left join public.operation_decisions d on d.operation_id=o.id
 where o.tenant_id=p_tenant order by o.created_at desc,o.id desc limit 50;
end $$;
revoke all on function komisio_private.valid_operation_payload(text,jsonb),komisio_private.preserve_operation() from public,anon,authenticated;
revoke all on function public.propose_operation(uuid,uuid,text,jsonb,text,timestamptz),public.decide_operation(uuid,uuid,uuid,text,text),public.operation_queue(uuid) from public,anon;
grant execute on function public.propose_operation(uuid,uuid,text,jsonb,text,timestamptz),public.decide_operation(uuid,uuid,uuid,text,text),public.operation_queue(uuid) to authenticated;
