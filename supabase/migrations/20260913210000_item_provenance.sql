-- P1 S7: keep the provenance the origin recorded. At acceptance one
-- `provenance` event cites who saved the origin, which facts were observed or
-- tentative, which model attempts touched the reviewed revision and whether an
-- agent proposal (staged operation) produced the origin. Facts only; no text.
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance'));

create function komisio_private.item_provenance(p_tenant uuid,p_origin_kind text,p_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare draft public.inspection_draft_revisions; review public.reception_reviews; op public.pending_operations; dec public.operation_decisions; staged jsonb; facts jsonb; attempts jsonb;
begin
 case p_origin_kind
 when 'inspection_draft' then
  select * into draft from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=p_origin_id order by revision desc limit 1;
  select * into op from public.pending_operations where tenant_id=p_tenant and id=draft.id;
  if found then
   select * into dec from public.operation_decisions where tenant_id=p_tenant and operation_id=op.id;
   staged:=jsonb_build_object('operationId',op.id,'kind',op.kind,'actorLabel',op.actor_label,'proposedBy',op.proposed_by,'decidedBy',dec.decided_by);
  end if;
  return jsonb_build_object('originKind',p_origin_kind,'savedBy',draft.created_by,'savedAt',draft.saved_at,'revision',draft.revision,'changeReason',draft.change_reason,'stagedOperation',staged);
 when 'reception_review' then
  select * into review from public.reception_reviews where tenant_id=p_tenant and session_id=p_origin_id order by version desc limit 1;
  select * into op from public.pending_operations where tenant_id=p_tenant and id=review.id;
  if found then
   select * into dec from public.operation_decisions where tenant_id=p_tenant and operation_id=op.id;
   staged:=jsonb_build_object('operationId',op.id,'kind',op.kind,'actorLabel',op.actor_label,'proposedBy',op.proposed_by,'decidedBy',dec.decided_by);
  end if;
  select coalesce(jsonb_object_agg(k,v->'certainty'),'{}'::jsonb) into facts from jsonb_each(review.suggestions->'metadata') as f(k,v) where jsonb_typeof(v)='object';
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'model',a.model,'promptVersion',a.prompt_version,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb) into attempts
   from public.reception_assistance_attempts a where a.tenant_id=p_tenant and a.session_id=p_origin_id and a.source_revision=review.source_revision;
  return jsonb_build_object('originKind',p_origin_kind,'reviewedBy',review.created_by,'reviewedAt',review.created_at,'reviewId',review.id,'version',review.version,'sourceRevision',review.source_revision,
   'facts',facts,'priceSourceIds',review.suggestions->'price'->'sourceIds','modelAttempts',attempts,'stagedOperation',staged);
 else
  return jsonb_build_object('originKind',p_origin_kind);
 end case;
end $$;
revoke all on function komisio_private.item_provenance(uuid,text,uuid) from public,anon,authenticated;

create or replace function public.accept_item(p_tenant uuid,p_id uuid,p_origin_kind text,p_origin_id uuid,p_origin_revision integer,p_price_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.items; policy_doc jsonb; pol jsonb; eff jsonb; current_agreement uuid;
 seller uuid; ownership text:='consignment'; custody_kind text; custody_id uuid; response uuid; evidence_kind text:='none'; evidence_id uuid; evidenced_agreement uuid;
 draft public.inspection_draft_revisions; bag public.bag_receipts; sess public.reception_sessions; review public.reception_reviews; resp public.reception_responses;
 src_rev integer; garment public.garment_receipts; purchase public.purchase_receipts; terms jsonb; origin_detail jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_origin_id is null or p_origin_kind is null or p_origin_kind not in ('inspection_draft','reception_review','purchase')
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999999
  or ((p_origin_kind='purchase')<>(p_origin_revision is null)) or (p_origin_revision is not null and p_origin_revision<=0) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.items where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.accepted_by is distinct from uid or prior.origin_kind is distinct from p_origin_kind
   or prior.origin_id is distinct from p_origin_id or prior.origin_revision is distinct from p_origin_revision
   or (select price_ore from public.item_prices where item_id=p_id order by set_at,id limit 1) is distinct from p_price_ore then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.items where tenant_id=p_tenant and origin_kind=p_origin_kind and origin_id=p_origin_id) then raise exception 'ITEM_EXISTS'; end if;
 policy_doc:=public.current_store_policy(p_tenant); pol:=policy_doc->'policy';
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 case p_origin_kind
 when 'inspection_draft' then
  select * into draft from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=p_origin_id order by revision desc limit 1;
  if not found then raise exception 'ORIGIN_NOT_FOUND'; end if;
  if draft.revision<>p_origin_revision then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
  if draft.archived then raise exception 'INSPECTION_ARCHIVED'; end if;
  select * into bag from public.bag_receipts where tenant_id=p_tenant and id=draft.bag_id;
  if not found then raise exception 'ORIGIN_NOT_FOUND'; end if;
  seller:=bag.seller_id; custody_kind:='bag'; custody_id:=bag.id;
  if bag.agreement_evidence_id is not null then evidence_kind:='staff_recorded'; evidence_id:=bag.agreement_evidence_id; evidenced_agreement:=bag.agreement_version_id; end if;
  origin_detail:=jsonb_build_object('draftId',draft.draft_id,'revision',draft.revision,'bagId',bag.id,'bagReference',bag.reference);
 when 'reception_review' then
  select * into sess from public.reception_sessions where tenant_id=p_tenant and id=p_origin_id;
  if not found then raise exception 'ORIGIN_NOT_FOUND'; end if;
  select * into review from public.reception_reviews where tenant_id=p_tenant and session_id=p_origin_id order by version desc limit 1;
  if not found then raise exception 'ORIGIN_NOT_FOUND'; end if;
  if review.version<>p_origin_revision then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
  select revision into src_rev from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_origin_id order by revision desc limit 1;
  if src_rev is distinct from review.source_revision then raise exception 'RECEPTION_CHANGED'; end if;
  select * into garment from public.garment_receipts where tenant_id=p_tenant and session_id=p_origin_id;
  if not found then raise exception 'CUSTODY_REQUIRED'; end if;
  seller:=sess.seller_id; custody_kind:='garment'; custody_id:=garment.id;
  select * into resp from public.reception_responses where tenant_id=p_tenant and review_id=review.id;
  if found and resp.decision='approve' then response:=resp.id; evidence_kind:='seller_response'; evidence_id:=resp.id; evidenced_agreement:=review.agreement_id; end if;
  if pol->>'sellerReviewMode'='per_item' then
   if response is null then raise exception 'SELLER_APPROVAL_REQUIRED'; end if;
   if p_price_ore<>round(review.price_amount*100)::bigint then raise exception 'PRICE_NOT_APPROVED'; end if;
  end if;
  origin_detail:=jsonb_build_object('sessionId',p_origin_id,'reviewId',review.id,'version',review.version,'sourceRevision',review.source_revision,'garmentReference',garment.reference);
 when 'purchase' then
  select * into purchase from public.purchase_receipts where tenant_id=p_tenant and id=p_origin_id;
  if not found then raise exception 'ORIGIN_NOT_FOUND'; end if;
  ownership:='store';
  origin_detail:=jsonb_build_object('purchaseId',purchase.id,'purchaseReference',purchase.reference);
 end case;
 if seller is not null and evidence_kind='none' and current_agreement is not null then
  select id into evidence_id from public.seller_agreement_evidence where tenant_id=p_tenant and seller_id=seller and agreement_id=current_agreement order by recorded_at desc limit 1;
  if evidence_id is not null then evidence_kind:='staff_recorded'; evidenced_agreement:=current_agreement; end if;
 end if;
 if seller is not null and (pol->'agreementRequiredFor') ? 'acceptance' then
  if current_agreement is null or evidence_kind='none' or evidenced_agreement is distinct from current_agreement then raise exception 'AGREEMENT_REQUIRED'; end if;
 end if;
 if seller is not null then
  eff:=public.effective_seller_terms(p_tenant,seller);
  terms:=jsonb_build_object('commissionBasis',eff->'commissionBasis','commissionRatePercent',eff->'commissionRatePercent','sellerTermsId',eff->'sellerTermsId','sellerTermsVersion',eff->'version');
 else
  terms:=jsonb_build_object('purchasePriceOre',purchase.purchase_price_ore,'marginEligible',purchase.margin_eligible,'purchaseEvidence',purchase.evidence_reference);
 end if;
 terms:=terms||jsonb_build_object('ownership',ownership,'salePeriodDays',pol->'salePeriodDays','markdownSteps',pol->'markdownSteps','endOfPeriodAction',pol->'endOfPeriodAction',
  'storePolicyId',policy_doc->'id','storePolicyVersion',policy_doc->'version','agreementVersionId',evidenced_agreement,'evidenceKind',evidence_kind,'evidenceId',evidence_id,'origin',origin_detail);
 insert into public.items(id,tenant_id,origin_kind,origin_id,origin_revision,response_id,custody_kind,custody_id,seller_id,ownership,terms,accepted_by)
 values(p_id,p_tenant,p_origin_kind,p_origin_id,p_origin_revision,response,custody_kind,custody_id,seller,ownership,terms,uid);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,p_id,p_price_ore,'accepted',uid);
 insert into public.item_events(tenant_id,item_id,kind,detail,actor) values
  (p_tenant,p_id,'accepted',jsonb_build_object('originKind',p_origin_kind)||origin_detail,uid),
  (p_tenant,p_id,'price_set',jsonb_build_object('priceOre',p_price_ore,'reason','accepted'),uid);
 -- S7: the origin's provenance travels with the item as one event.
 if p_origin_kind<>'purchase' then
  insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,p_id,'provenance',komisio_private.item_provenance(p_tenant,p_origin_kind,p_origin_id),uid);
 end if;
 perform komisio_private.record_access(p_tenant,'item.accepted',p_id,jsonb_build_object('originKind',p_origin_kind,'originId',p_origin_id));
 return p_id;
end $$;
