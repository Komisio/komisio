-- Optional agreement means null, never fabricated seller terms.
alter table public.reception_reviews alter column agreement_id drop not null;
create or replace function public.receive_bag_with_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_note text,p_expected_agreement uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.bag_receipts;
 current_version public.seller_agreement_versions; evidence_id uuid; n text:=trim(p_note);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or n is null or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Replay is resolved before changed policy prerequisites; no previous receipt is rewritten.
 select * into previous from public.bag_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.seller_id is distinct from p_seller or previous.note is distinct from n
  or previous.agreement_version_id is distinct from p_expected_agreement then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.sellers where id=p_seller and tenant_id=p_tenant) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into current_version from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 select id into evidence_id from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=current_version.id order by recorded_at desc,id limit 1;
 if (coalesce(current_version.required_before_receipt,false) or ((public.current_store_policy(p_tenant)->'policy'->'agreementRequiredFor') ? 'bag_receipt')) and evidence_id is null then raise exception 'AGREEMENT_REQUIRED'; end if;
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by,agreement_version_id,agreement_evidence_id)
 values(p_id,p_tenant,p_seller,n,uid,current_version.id,evidence_id);
 perform komisio_private.record_access(p_tenant,'bag.received',p_id,jsonb_build_object('agreement_id',current_version.id,'evidence_id',evidence_id));
 return p_id;
end $$;

create or replace function public.publish_reception_review(p_tenant uuid,p_request uuid,p_session uuid,p_source_revision integer,p_previous uuid,p_agreement uuid,p_suggestions jsonb,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_reviews where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid
   or prior.source_revision is distinct from p_source_revision or prior.previous_review_id is distinct from p_previous
   or prior.agreement_id is distinct from p_agreement or prior.suggestions is distinct from p_suggestions or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 select s.email into address from public.reception_sessions r join public.sellers s on s.id=r.seller_id and s.tenant_id=r.tenant_id where r.id=p_session and r.tenant_id=p_tenant;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into src from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if not found or src.revision<>p_source_revision then raise exception 'RECEPTION_CHANGED'; end if;
 select * into latest from public.reception_reviews where session_id=p_session order by version desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
 if coalesce(latest.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_agreement is null and ((public.current_store_policy(p_tenant)->'policy'->'agreementRequiredFor') ? 'review_publication') then raise exception 'AGREEMENT_REQUIRED'; end if;
 if not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'RECEPTION_REVIEW_EXPIRED'; end if;
 for fact in select v from jsonb_each(p_suggestions->'metadata') as fields(k,v) loop
  for ref in select * from jsonb_array_elements_text(fact->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
 end loop;
 for ref in select * from jsonb_array_elements_text(p_suggestions->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,p_suggestions,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $$;
create or replace function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if p_kind='saveInspectionDraft' then
  if not(value ?& array['bagId','draftId','expectedRevision','fields']) or (value-array['bagId','draftId','expectedRevision','fields'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(value->'bagId')<>'string' or (value->>'bagId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'draftId')<>'string' or (value->>'draftId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'expectedRevision')<>'number' or (value->>'expectedRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'expectedRevision')::bigint>2147483646 then return false; end if;
  if jsonb_typeof(value->'fields')<>'object' or not((value->'fields') ?& array['description','category','condition']) or ((value->'fields')-array['description','category','condition'])<>'{}'::jsonb then return false; end if;
  return jsonb_typeof(value#>'{fields,description}')='string' and length(trim(value#>>'{fields,description}')) between 1 and 1000
   and jsonb_typeof(value#>'{fields,category}')='string' and length(trim(value#>>'{fields,category}'))<=120
   and jsonb_typeof(value#>'{fields,condition}')='string' and length(trim(value#>>'{fields,condition}'))<=500;
 end if;
 if p_kind='publishReceptionReview' then
  if not(value ?& array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])
   or (value-array['sessionId','sourceRevision','previousReviewId','agreementId','expiresAt','suggestions'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(value->'sessionId')<>'string' or (value->>'sessionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'agreementId') not in ('null','string') or (value->>'agreementId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(value->'previousReviewId') not in ('null','string')
   or (jsonb_typeof(value->'previousReviewId')='string' and (value->>'previousReviewId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
  if jsonb_typeof(value->'sourceRevision')<>'number' or (value->>'sourceRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'sourceRevision')::bigint>2147483646 then return false; end if;
  if jsonb_typeof(value->'expiresAt')<>'string' or length(value->>'expiresAt')>40 then return false; end if;
  return komisio_private.valid_reception_review(value->'suggestions');
 end if;
 return false;
end $$;

create or replace function public.propose_operation(p_tenant uuid,p_id uuid,p_kind text,p_payload jsonb,p_actor_label text,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.pending_operations; label text:=trim(p_actor_label);
 sid uuid; rev integer; prev uuid; agr uuid; review_expiry timestamptz; src public.reception_source_revisions; latest public.reception_reviews; current_agreement uuid; fact jsonb; ref text; draft public.inspection_draft_revisions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_kind is null or p_kind not in ('publishReceptionReview','saveInspectionDraft') or label is null or length(label) not between 1 and 100
  or p_expires is null or not isfinite(p_expires) or not komisio_private.valid_operation_payload(p_kind,p_payload) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.pending_operations where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.kind is distinct from p_kind or prior.payload is distinct from p_payload
   or prior.proposed_by is distinct from uid or prior.actor_label is distinct from label or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
 if p_kind='saveInspectionDraft' then
  select * into draft from public.inspection_draft_revisions where tenant_id=p_tenant and bag_id=(p_payload->>'bagId')::uuid and draft_id=(p_payload->>'draftId')::uuid order by revision desc limit 1;
  if not found then raise exception 'INSPECTION_NOT_FOUND'; end if;
  if draft.archived then raise exception 'INSPECTION_ARCHIVED'; end if;
  if draft.revision<>(p_payload->>'expectedRevision')::integer then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
  if draft.description=trim(p_payload#>>'{fields,description}') and draft.category=trim(p_payload#>>'{fields,category}') and draft.condition=trim(p_payload#>>'{fields,condition}') then raise exception 'INSPECTION_UNCHANGED'; end if;
  insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
   values(p_id,p_tenant,p_kind,'low',p_payload,'agent',label,uid,p_expires);
  perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label,'bag_id',p_payload->>'bagId','draft_id',p_payload->>'draftId'));
  return p_id;
 end if;
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
 -- Risk is derived from the kind, never supplied by the proposer.
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,'low',p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label,'session_id',sid));
 return p_id;
end $$;

