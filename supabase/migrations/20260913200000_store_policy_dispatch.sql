-- S0 was merged/applied while S1 was in review. Preserve its dispatch boundary
-- on fresh installs and when backfilling earlier S1 migrations into staging.
create or replace function komisio_private.op_validate_publish_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])
  or (value-array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'sessionId')<>'string' or (value->>'sessionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'agreementId') not in ('null','string') or (value->>'agreementId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'previousReviewId') not in ('null','string')
  or (jsonb_typeof(value->'previousReviewId')='string' and (value->>'previousReviewId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
 if jsonb_typeof(value->'sourceRevision')<>'number' or (value->>'sourceRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'sourceRevision')::bigint>2147483646 then return false; end if;
 if jsonb_typeof(value->'expiresAt')<>'string' or length(value->>'expiresAt')>40 then return false; end if;
 return komisio_private.valid_reception_review(value->'suggestions');
end $$;

create or replace function komisio_private.op_preflight_publish_reception_review(p_tenant uuid,p_payload jsonb) returns jsonb
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
 if agr is null and ((public.current_store_policy(p_tenant)->'policy'->'agreementRequiredFor') ? 'review_publication') then raise exception 'AGREEMENT_REQUIRED'; end if;
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

create or replace function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 case p_kind
  when 'publishReceptionReview' then return komisio_private.op_validate_publish_reception_review(value);
  when 'saveInspectionDraft' then return komisio_private.op_validate_save_inspection_draft(value);
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
  else raise exception 'INVALID_INPUT';
 end case;
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,risk,p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label)||detail);
 return p_id;
end $$;

