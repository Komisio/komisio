-- #458: retire inspection drafts; accepted item financial records remain immutable.

-- item_attributes
CREATE OR REPLACE FUNCTION komisio_private.item_attributes(p_tenant uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.items; out jsonb:='[]'::jsonb; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select komisio_private.stored_review_attributes(suggestions) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  -- The owner explicitly retired this source; later corrections still apply.
  out:='[]'::jsonb;
 else
  select supplier_note into note from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  if nullif(trim(coalesce(note,'')),'') is not null then
   out:=jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value',note,'sourceIds','[]'::jsonb,'certainty','observed'));
  end if;
 end if;
 out:=coalesce(out,'[]'::jsonb);
 for a in select * from jsonb_array_elements(out) loop
  select * into c from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and k.slug=a->>'slug'
   order by k.seq desc limit 1;
  if found then
   merged:=merged||jsonb_build_array(a||jsonb_build_object('value',c.value,'definitionVersion',c.definition_version,'source','corrected',
    'accepted',jsonb_build_object('value',a->>'value','at',item.accepted_at),
    'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
  else
   merged:=merged||jsonb_build_array(a||jsonb_build_object('source','accepted'));
  end if;
  seen:=seen||(a->>'slug');
 end loop;
 -- A correction may also add something the reception never recorded, such as a
 -- socket nobody noted at the counter.
 for c in select distinct on (k.slug) k.* from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and not(k.slug=any(seen))
   order by k.slug, k.seq desc loop
  merged:=merged||jsonb_build_array(jsonb_build_object('slug',c.slug,'definitionVersion',c.definition_version,'value',c.value,
   'sourceIds','[]'::jsonb,'certainty','observed','source','corrected','accepted',null,
   'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
 end loop;
 return merged;
end $function$;

-- item_provenance
CREATE OR REPLACE FUNCTION komisio_private.item_provenance(p_tenant uuid, p_origin_kind text, p_origin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review public.reception_reviews; op public.pending_operations; dec public.operation_decisions; staged jsonb; facts jsonb; attempts jsonb;
begin
 case p_origin_kind
 when 'inspection_draft' then
  return jsonb_build_object('originKind',p_origin_kind,'sourceRetired',true);
 when 'reception_review' then
  select * into review from public.reception_reviews where tenant_id=p_tenant and session_id=p_origin_id order by version desc limit 1;
  select * into op from public.pending_operations where tenant_id=p_tenant and id=review.id;
  if found then
   select * into dec from public.operation_decisions where tenant_id=p_tenant and operation_id=op.id;
   staged:=jsonb_build_object('operationId',op.id,'kind',op.kind,'actorLabel',op.actor_label,'proposedBy',op.proposed_by,'decidedBy',dec.decided_by);
  end if;
  select coalesce(jsonb_object_agg(a->>'slug',to_jsonb(a->>'certainty')),'{}'::jsonb) into facts from jsonb_array_elements(komisio_private.stored_review_attributes(review.suggestions)) a;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'model',a.model,'promptVersion',a.prompt_version,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb) into attempts
   from public.reception_assistance_attempts a where a.tenant_id=p_tenant and a.session_id=p_origin_id and a.source_revision=review.source_revision;
  return jsonb_build_object('originKind',p_origin_kind,'reviewedBy',review.created_by,'reviewedAt',review.created_at,'reviewId',review.id,'version',review.version,'sourceRevision',review.source_revision,
   'facts',facts,'priceSourceIds',review.suggestions->'price'->'sourceIds','modelAttempts',attempts,'stagedOperation',staged);
 else
  return jsonb_build_object('originKind',p_origin_kind);
 end case;
end $function$;

-- accept_item
CREATE OR REPLACE FUNCTION public.accept_item(p_tenant uuid, p_id uuid, p_origin_kind text, p_origin_id uuid, p_origin_revision integer, p_price_ore bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); prior public.items; policy_doc jsonb; pol jsonb; eff jsonb; current_agreement uuid;
 seller uuid; ownership text:='consignment'; custody_kind text; custody_id uuid; response uuid; evidence_kind text:='none'; evidence_id uuid; evidenced_agreement uuid;
 bag public.bag_receipts; sess public.reception_sessions; review public.reception_reviews; resp public.reception_responses;
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
  raise exception 'ORIGIN_RETIRED';
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
 if evidence_kind='staff_recorded' then
  select source into evidence_kind from public.seller_agreement_evidence where tenant_id=p_tenant and id=evidence_id;
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
end $function$;

-- op_preflight_accept_item
CREATE OR REPLACE FUNCTION komisio_private.op_preflight_accept_item(p_tenant uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text:=p_payload->>'originKind'; oid uuid:=(p_payload->>'originId')::uuid; rev integer:=(p_payload->>'originRevision')::integer; latest integer;
begin
 if exists(select 1 from public.items where tenant_id=p_tenant and origin_kind=kind and origin_id=oid) then raise exception 'ITEM_EXISTS'; end if;
 case kind
 when 'inspection_draft' then
  raise exception 'ORIGIN_RETIRED';
 when 'reception_review' then
  select version into latest from public.reception_reviews where tenant_id=p_tenant and session_id=oid order by version desc limit 1;
  if latest is null then raise exception 'ORIGIN_NOT_FOUND'; end if;
  if latest<>rev then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
  if not exists(select 1 from public.garment_receipts where tenant_id=p_tenant and session_id=oid) then raise exception 'CUSTODY_REQUIRED'; end if;
 when 'purchase' then
  if not exists(select 1 from public.purchase_receipts where tenant_id=p_tenant and id=oid) then raise exception 'ORIGIN_NOT_FOUND'; end if;
 end case;
 return jsonb_build_object('origin_kind',kind,'origin_id',oid);
end $function$;

-- op_validate_accept_item
CREATE OR REPLACE FUNCTION komisio_private.op_validate_accept_item(value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['originKind','originId','originRevision','priceOre']) or (value-array['originKind','originId','originRevision','priceOre'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'originKind')<>'string' or value->>'originKind' not in ('reception_review','purchase') then return false; end if;
 if jsonb_typeof(value->'originId')<>'string' or (value->>'originId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if (value->>'originKind'='purchase')<>(jsonb_typeof(value->'originRevision')='null') then return false; end if;
 if jsonb_typeof(value->'originRevision')='number' and ((value->>'originRevision') !~ '^[1-9][0-9]{0,9}$' or (value->>'originRevision')::bigint>2147483646) then return false; end if;
 if jsonb_typeof(value->'originRevision') not in ('null','number') then return false; end if;
 if jsonb_typeof(value->'priceOre')<>'number' or (value->>'priceOre') !~ '^[1-9][0-9]{0,10}$' or (value->>'priceOre')::bigint>99999999999 then return false; end if;
 return true;
end $function$;

-- valid_operation_payload
CREATE OR REPLACE FUNCTION komisio_private.valid_operation_payload(p_kind text, value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 case p_kind
  when 'publishReceptionReview' then return komisio_private.op_validate_publish_reception_review(value);
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
end $function$;

-- operation_risk
CREATE OR REPLACE FUNCTION komisio_private.operation_risk(p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 case p_kind
  when 'publishReceptionReview' then return 'low';
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
end $function$;

-- propose_operation
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
end $function$;

-- decide_operation
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
end $function$;

-- operation_queue_filtered_page
CREATE OR REPLACE FUNCTION public.operation_queue_filtered_page(p_tenant uuid, p_status text, p_before_created timestamp with time zone, p_before_id uuid, p_kind text)
 RETURNS TABLE(id uuid, kind text, risk_level text, actor_kind text, actor_label text, proposed_by uuid, payload jsonb, expires_at timestamp with time zone, created_at timestamp with time zone, status text, decision_id uuid, outcome text, result_id uuid, error_code text, reason text, decided_by uuid, decided_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_kind is not null and p_kind not in ('publishReceptionReview','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts','updateStoreProfile','importSellers','useAgreementDraft','useAccountingDraft'))
  or p_status is null or p_status not in ('all','open','expired','executed','failed','rejected')
  or (p_before_created is null)<>(p_before_id is null)
  or (p_before_created is not null and not isfinite(p_before_created)) then raise exception 'INVALID_INPUT'; end if;
 return query
 select o.id,o.kind,o.risk_level,o.actor_kind,o.actor_label,o.proposed_by,o.payload,o.expires_at,o.created_at,
  case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end,
  d.id,d.outcome,d.result_id,d.error_code,d.reason,d.decided_by,d.created_at
 from public.pending_operations o left join public.operation_decisions d on d.operation_id=o.id
 where o.tenant_id=p_tenant and o.kind<>'saveInspectionDraft'
  and not (o.kind='acceptItem' and o.payload->>'originKind'='inspection_draft')
  and (p_kind is null or o.kind=p_kind)
  and (p_before_created is null or (o.created_at,o.id)<(p_before_created,p_before_id))
  and (p_status='all' or (case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end)=p_status)
 order by o.created_at desc,o.id desc limit 21;
end $function$;

-- require_open_intake_seller
CREATE OR REPLACE FUNCTION komisio_private.require_open_intake_seller()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare seller uuid;
begin
 perform 1 from public.tenants where id=new.tenant_id for update;
  select seller_id into seller from public.reception_sessions where tenant_id=new.tenant_id and id=new.session_id;
 if exists(select 1 from public.sellers where tenant_id=new.tenant_id and id=seller and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 return new;
end $function$;

-- guard_completed_bag
CREATE OR REPLACE FUNCTION komisio_private.guard_completed_bag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bag uuid;
begin
 if tg_table_name='items' then
  if new.origin_kind='reception_review' then select bag_id into bag from public.reception_sessions where tenant_id=new.tenant_id and id=new.origin_id; end if;
 elsif tg_table_name='reception_sessions' then bag:=new.bag_id;
 else select bag_id into bag from public.reception_sessions where tenant_id=new.tenant_id and id=new.session_id; end if;
 if bag is null then return new; end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if (select state from public.bag_processing_events where tenant_id=new.tenant_id and bag_id=bag order by version desc limit 1)='completed' then raise exception 'BAG_COMPLETED'; end if;
 return new;
end $function$;

-- bag_registered_items_page
CREATE OR REPLACE FUNCTION public.bag_registered_items_page(p_tenant uuid, p_bag uuid, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare skip integer:=coalesce(p_offset,0); rows jsonb; total integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 with scan as (
  select i.id,s.id as session_id,i.accepted_at
  from public.reception_sessions s join public.items i on i.tenant_id=s.tenant_id and i.origin_kind='reception_review' and i.origin_id=s.id
  where s.tenant_id=p_tenant and s.bag_id=p_bag
  union all
  select i.id,null::uuid as session_id,i.accepted_at
  from public.items i
  where i.tenant_id=p_tenant and i.origin_kind='inspection_draft'
  and (i.custody_kind='bag' and i.custody_id=p_bag)
 ), page as (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select count(*)::int,coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'session_id',p.session_id,'title',komisio_private.item_title(p_tenant,p.id)->>'title',
  'stage',komisio_private.item_lifecycle(p_tenant,p.id)->>'stage',
  'sold_price_ore',(select l.price_ore::text from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
    where l.tenant_id=p_tenant and l.item_id=p.id and s.status='completed'
    and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id) order by s.occurred_at desc limit 1),
  'price_ore',(select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=p.id order by seq desc limit 1),
  'photo_id',(select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=p.session_id and e->>'kind'='photo' order by r.revision desc,e->>'id' limit 1)
 ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb) into total,rows from scan;
 return jsonb_build_object('items',rows,'total',total,'offset',skip);
end $function$;

-- item_label_sheet_facts
CREATE OR REPLACE FUNCTION public.item_label_sheet_facts(p_tenant uuid, p_bag uuid DEFAULT NULL::uuid, p_items uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ids uuid[]; output jsonb := '[]'::jsonb; v_item uuid; stage text; skipped integer := 0;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_bag is null) = (p_items is null) then raise exception 'INVALID_INPUT'; end if;
 if p_bag is not null then
  if not exists(select 1 from public.bag_receipts b where b.tenant_id=p_tenant and b.id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
  select array_agg(i.id order by i.accepted_at,i.id) into ids from public.items i
  where i.tenant_id=p_tenant and (
   (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.id=i.origin_id and s.bag_id=p_bag))
   or (i.origin_kind='inspection_draft' and (i.custody_kind='bag' and i.custody_id=p_bag))
  );
 else
  if cardinality(p_items) not between 1 and 200 or array_position(p_items,null) is not null then raise exception 'INVALID_INPUT'; end if;
  select array_agg(v order by n) into ids from (select v,min(n) n from unnest(p_items) with ordinality as u(v,n) group by v) s;
 end if;
 if coalesce(cardinality(ids),0)>200 then raise exception 'TOO_MANY_ITEMS'; end if;
 foreach v_item in array coalesce(ids,array[]::uuid[]) loop
  if not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=v_item) then raise exception 'ITEM_NOT_AVAILABLE'; end if;
  stage:=komisio_private.item_lifecycle(p_tenant,v_item)->>'stage';
  if stage in ('on_sale','markdown_due','period_ending') then
   output:=output||jsonb_build_array(public.item_label_facts(p_tenant,v_item));
  elsif p_bag is null then raise exception 'ITEM_NOT_AVAILABLE';
  else skipped:=skipped+1;
  end if;
 end loop;
 return jsonb_build_object('items',output,'skipped',skipped);
end $function$;

-- items_search_page
CREATE OR REPLACE FUNCTION public.items_search_page(p_tenant uuid, p_filters jsonb, p_sort text, p_direction text, p_limit integer, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f jsonb:=coalesce(p_filters,'{}'); k text; v text; rows jsonb; total integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(f)<>'object' or p_sort is null or p_sort not in ('title','category','seller','price','stage','accepted','periodEnd')
  or p_direction is null or p_direction not in ('asc','desc') or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'INVALID_INPUT'; end if;
 for k,v in select key,value from jsonb_each_text(f) loop
  if k not in ('bag','q','stage','ownership','seller','category','itemType','assortment','minPrice','maxPrice','acceptedFrom','acceptedTo','endsBefore','photo','origin','paypal','syncProvider','syncStatus')
   or jsonb_typeof(f->k)<>'string' or v is null or length(v)>120 then raise exception 'INVALID_INPUT'; end if;
  if v='' then f:=f-k; end if;
 end loop;
 if f->>'syncProvider' not in ('paypal','shopify') or f->>'syncStatus' not in ('not_sent','changed','failed','attention','synced','inactive','linked') or f->>'stage' not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold')
  or f->>'ownership' not in ('consignment','store') or f->>'photo' not in ('yes','no')
  or f->>'paypal' not in ('not_sent','changed','failed','attention','synced','inactive') or f->>'origin' not in ('inspection_draft','reception_review','purchase') then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['minPrice','maxPrice'] loop
  if f ? k and f->>k !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' then raise exception 'INVALID_INPUT'; end if;
 end loop;
 foreach k in array array['acceptedFrom','acceptedTo','endsBefore'] loop
  if f ? k then
   if f->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
   begin perform (f->>k)::date; exception when others then raise exception 'INVALID_INPUT'; end;
  end if;
 end loop;
 if (f->>'minPrice')::numeric>(f->>'maxPrice')::numeric or f->>'acceptedFrom'>f->>'acceptedTo' then raise exception 'INVALID_INPUT'; end if;
 if f ? 'bag' then
  begin perform (f->>'bag')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=(f->>'bag')::uuid) then raise exception 'BAG_NOT_FOUND'; end if;
 end if;
 with facts as materialized (
  select i.id,i.origin_kind,i.seller_id,i.ownership,i.accepted_at,s.name as seller,
   c.value as classification,t.value->>'title' as title,t.value->>'category' as category,l.value as lifecycle,
   case when f ? 'bag' and l.value->>'stage'='sold' then
    (select sl.price_ore from public.sale_lines sl join public.sales sa on sa.tenant_id=sl.tenant_id and sa.id=sl.sale_id
     where sl.tenant_id=p_tenant and sl.item_id=i.id and sa.status='completed'
      and not exists(select 1 from public.sale_returns sr where sr.tenant_id=sl.tenant_id and sr.sale_line_id=sl.id)
     order by sa.occurred_at desc limit 1)
    else (l.value->>'currentPriceOre')::bigint end as price,(l.value->>'periodEnd')::timestamptz as period_end,
   ps.value as paypal,sync.value as sync,l.value->>'stage' as stage,m.value->>'defaultPhotoId' as photo_id,jsonb_array_length(m.value->'photos') as photo_count
  from public.items i
  left join public.sellers s on s.tenant_id=i.tenant_id and s.id=i.seller_id
  cross join lateral (select komisio_private.item_title(p_tenant,i.id) value) t
  cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) value) l
  cross join lateral (select komisio_private.item_photo_snapshot(p_tenant,i.id) value) m
  cross join lateral (select komisio_private.paypal_item_snapshot(p_tenant,i.id) value) ps
  cross join lateral (select komisio_private.item_sync_snapshot(p_tenant,i.id) value) sync
  cross join lateral (select komisio_private.item_classification(p_tenant,i.id) value) c
  where i.tenant_id=p_tenant
   and (not f ? 'bag' or
    (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions rs where rs.tenant_id=p_tenant and rs.id=i.origin_id and rs.bag_id=(f->>'bag')::uuid)) or
    (i.origin_kind='inspection_draft' and (i.custody_kind='bag' and i.custody_id=(f->>'bag')::uuid)))
   and (not f ? 'ownership' or i.ownership=f->>'ownership')
   and (not f ? 'origin' or i.origin_kind=f->>'origin')
   and (not f ? 'seller' or strpos(lower(coalesce(s.name,'')),lower(f->>'seller'))>0 or i.seller_id::text=f->>'seller')
   and (not f ? 'acceptedFrom' or i.accepted_at>=((f->>'acceptedFrom')::date::timestamp at time zone 'Europe/Stockholm'))
   and (not f ? 'acceptedTo' or i.accepted_at<(((f->>'acceptedTo')::date+1)::timestamp at time zone 'Europe/Stockholm'))
 ), matches as materialized (
  select * from facts where
   (not f ? 'q' or strpos(lower(coalesce(title,'')||' '||coalesce(category,'')),lower(f->>'q'))>0 or id::text=f->>'q')
   and (not (f ? 'syncProvider' or f ? 'syncStatus') or exists(select 1 from jsonb_array_elements(sync) connection where (not f ? 'syncProvider' or connection->>'provider'=f->>'syncProvider') and (not f ? 'syncStatus' or connection->>'status'=f->>'syncStatus')))
   and (not f ? 'paypal' or paypal->>'status'=f->>'paypal')
   and (not f ? 'itemType' or classification->>'itemType'=f->>'itemType')
   and (not f ? 'assortment' or classification->>'assortment'=f->>'assortment')
   and (not f ? 'category' or strpos(lower(coalesce(category,'')),lower(f->>'category'))>0)
   and (not f ? 'stage' or stage=f->>'stage')
   and (not f ? 'minPrice' or price>=(f->>'minPrice')::numeric*100)
   and (not f ? 'maxPrice' or price<=(f->>'maxPrice')::numeric*100)
   and (not f ? 'endsBefore' or period_end<(((f->>'endsBefore')::date+1)::timestamp at time zone 'Europe/Stockholm'))
   and (not f ? 'photo' or (photo_id is not null)=(f->>'photo'='yes'))
 ), ordered as (
  select *,row_number() over(order by
   case when p_direction='asc' then case p_sort when 'title' then lower(title) when 'category' then lower(category) when 'seller' then lower(seller) when 'stage' then stage end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'title' then lower(title) when 'category' then lower(category) when 'seller' then lower(seller) when 'stage' then stage end end desc nulls last,
   case when p_sort='price' and p_direction='asc' then price end asc nulls last,
   case when p_sort='price' and p_direction='desc' then price end desc nulls last,
   case when p_direction='asc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end desc nulls last,id) as position
  from matches
 ), page as (select * from ordered order by position limit p_limit offset p_offset)
 select (select count(*)::int from matches),coalesce(jsonb_agg(jsonb_build_object(
  'classification',p.classification,'sync',p.sync,'paypal',p.paypal,'id',p.id,'title',p.title,'category',p.category,'sellerId',p.seller_id,'sellerName',p.seller,'ownership',p.ownership,
  'originKind',p.origin_kind,'acceptedAt',p.accepted_at,'periodEnd',p.period_end,'currentPriceOre',p.price,'stage',p.stage,
  'defaultPhotoId',p.photo_id,'photoCount',p.photo_count,'nextMarkdownAt',n.value->>'at','nextMarkdownPercent',n.value->'percent'
 ) order by p.position),'[]') into total,rows
 from page p cross join lateral (select komisio_private.next_markdown(p.lifecycle) value) n;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows,'total',total,'limit',p_limit,'offset',p_offset);
end $function$;

-- bag_work_summary
CREATE OR REPLACE FUNCTION public.bag_work_summary(p_tenant uuid, p_bag uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare accepted integer; receptions integer; next_reception uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant and (
  (i.origin_kind='inspection_draft' and (i.custody_kind='bag' and i.custody_id=p_bag))
  or (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.bag_id=p_bag and s.id=i.origin_id))
 );
 select count(*)::int,(array_agg(q.session_id order by q.created_at,q.session_id))[1] into receptions,next_reception
 from public.reception_queue_facts(p_tenant,null,null,null,null,p_bag) q
 where q.stage not in ('accepted','declined')
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='reception_review' and i.origin_id=q.session_id);
 return jsonb_build_object('accepted',accepted,'receptions',receptions,'nextReception',next_reception);
end $function$;

-- set_bag_processing
CREATE OR REPLACE FUNCTION public.set_bag_processing(p_tenant uuid, p_id uuid, p_bag uuid, p_expected integer, p_state text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); prior public.bag_processing_events; latest public.bag_processing_events; work jsonb; reason text:=trim(p_reason);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_bag is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_state is null or p_state not in ('open','completed') or reason is null or length(reason)>500 or (p_state='open' and reason='') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.bag_processing_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.bag_id is distinct from p_bag or prior.created_by is distinct from uid or prior.version<>p_expected+1 or prior.state<>p_state or prior.reason<>reason then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select * into latest from public.bag_processing_events where tenant_id=p_tenant and bag_id=p_bag order by version desc limit 1;
 if coalesce(latest.version,0)<>p_expected or coalesce(latest.state,'open')=p_state then raise exception 'BAG_PROCESSING_CHANGED'; end if;
 if p_state='completed' then
  work:=public.bag_work_summary(p_tenant,p_bag);
  if (work->>'receptions')::integer>0 then raise exception 'BAG_PENDING_WORK'; end if;
 end if;
 insert into public.bag_processing_events(id,tenant_id,bag_id,version,state,reason,created_by,actor_name)
 values(p_id,p_tenant,p_bag,p_expected+1,p_state,reason,uid,coalesce((select display_name from public.user_profiles where user_id=uid),''));
 perform komisio_private.record_access(p_tenant,'bag.processing_changed',p_bag,jsonb_build_object('version',p_expected+1,'state',p_state));
 return p_id;
end $function$;

-- flow_dropoffs
CREATE OR REPLACE FUNCTION public.flow_dropoffs(p_tenant uuid, p_state text)
 RETURNS SETOF bag_receipts
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_state is null or p_state not in ('unstarted','open','completed') then raise exception 'INVALID_INPUT'; end if;
 return query select b.* from public.bag_receipts b where b.tenant_id=p_tenant and
 coalesce((select e.state from public.bag_processing_events e where e.tenant_id=p_tenant and e.bag_id=b.id order by e.version desc limit 1),'open')=case when p_state='completed' then 'completed' else 'open' end and
 (p_state<>'unstarted' or (
 not exists(select 1 from public.reception_sessions s where s.tenant_id=b.tenant_id and s.bag_id=b.id)
 and not exists(select 1 from public.items i where i.tenant_id=b.tenant_id and i.custody_kind='bag' and i.custody_id=b.id)));
end $function$;

-- store_flow_snapshot
CREATE OR REPLACE FUNCTION public.store_flow_snapshot(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare dropoffs jsonb; reception jsonb; inventory jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_build_object('count',count(*),'oldest',min(b.received_at)) into dropoffs from public.flow_dropoffs(p_tenant,'unstarted') b;
 select coalesce(jsonb_object_agg(q.stage,q.metric),'{}'::jsonb) into reception from (
 select r.stage,jsonb_build_object('count',count(*),'oldest',min(r.created_at)) metric
 from public.reception_queue_facts(p_tenant) r where r.stage<>'accepted' group by r.stage) q;
 select coalesce(jsonb_object_agg(q.stage,q.metric),'{}'::jsonb) into inventory from (
 select komisio_private.item_lifecycle(p_tenant,i.id)->>'stage' stage,
 jsonb_build_object('count',count(*),'oldest',min(i.accepted_at)) metric
 from public.items i where i.tenant_id=p_tenant group by 1) q;
 return jsonb_build_object('asOf',now(),'dropoffs',dropoffs,'reception',reception,'inventory',inventory);
end $function$;

-- seller_data_export
CREATE OR REPLACE FUNCTION public.seller_data_export(p_tenant uuid, p_seller uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); s public.sellers; result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 result:=jsonb_build_object(
  'exportedAt',now(),'exportedBy',uid,'tenantId',p_tenant,
  'seller',to_jsonb(s)-'tenant_id',
  'profileHistory',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.revision),'[]') from public.seller_profile_versions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'terms',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.version),'[]') from public.seller_terms_versions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'agreementEvidence',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.recorded_at),'[]') from public.seller_agreement_evidence x where x.tenant_id=p_tenant and x.seller_id=p_seller),

  'acceptedAgreementTranslations',(select coalesce(jsonb_agg(to_jsonb(t)-'tenant_id' order by t.created_at,t.id),'[]') from public.seller_agreement_translations t where t.tenant_id=p_tenant and exists(select 1 from public.seller_agreement_evidence e where e.tenant_id=p_tenant and e.seller_id=p_seller and e.translation_id=t.id)),
  'acceptedAgreements',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'title',a.title,'body',a.body,'language',a.language) order by a.version),'[]') from public.seller_agreement_versions a where a.tenant_id=p_tenant and exists(select 1 from public.seller_agreement_evidence e where e.tenant_id=p_tenant and e.seller_id=p_seller and e.agreement_id=a.id)),
  'photoSubmissions',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'seller_id',x.seller_id,'previous_id',x.previous_id,'description',x.description,'photos',x.photos,'created_by',x.created_by,'created_at',x.created_at,'pricing_mode',x.pricing_mode,'seller_price',x.seller_price,'price_currency',x.price_currency,'assistance_output',x.assistance_output) order by x.created_at,x.id),'[]') from public.seller_submissions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'photoSubmissionReviews',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'submission_id',r.submission_id,'decision',r.decision,'note',r.note,'price_approved',r.price_approved,'created_by',r.created_by,'created_at',r.created_at) order by r.created_at,r.id),'[]') from public.seller_submission_reviews r join public.seller_submissions x on x.tenant_id=r.tenant_id and x.id=r.submission_id where r.tenant_id=p_tenant and x.seller_id=p_seller),
  'submissionReceptions',(select coalesce(jsonb_agg(to_jsonb(r)-'tenant_id' order by r.created_at,r.submission_id),'[]') from public.submission_receptions r join public.seller_submissions x on x.tenant_id=r.tenant_id and x.id=r.submission_id join public.reception_sessions rs on rs.tenant_id=r.tenant_id and rs.id=r.session_id where r.tenant_id=p_tenant and x.seller_id=p_seller and rs.seller_id=p_seller),
  'notificationPreferences',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.seller_notification_preferences x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'handovers',(select coalesce(jsonb_agg(to_jsonb(h)-'tenant_id' order by h.created_at,h.id),'[]') from public.seller_handovers h where h.tenant_id=p_tenant and h.seller_id=p_seller),
  'handoverEvents',(select coalesce(jsonb_agg(to_jsonb(e)-'tenant_id' order by e.occurred_at,e.id),'[]') from public.handover_events e join public.seller_handovers h on h.tenant_id=e.tenant_id and h.id=e.handover_id where e.tenant_id=p_tenant and h.seller_id=p_seller),
  'bags',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.bag_receipts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'receptions',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_sessions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'receptionSources',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.reception_source_revisions x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionReviews',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_reviews x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionResponses',(select coalesce(jsonb_agg(to_jsonb(r)-'tenant_id'-'access_id' order by r.created_at,r.id),'[]') from public.reception_responses r join public.reception_reviews rv on rv.tenant_id=r.tenant_id and rv.id=r.review_id join public.reception_sessions rs on rs.tenant_id=rv.tenant_id and rs.id=rv.session_id where r.tenant_id=p_tenant and rs.seller_id=p_seller),
  'garments',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.garment_receipts x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'items',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.accepted_at),'[]') from public.items x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'itemEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.item_events x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'itemPrices',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.item_prices x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'saleLines',(select coalesce(jsonb_agg((to_jsonb(l)-'tenant_id')||jsonb_build_object('sale',to_jsonb(sa)-'tenant_id') order by sa.occurred_at),'[]') from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id where l.tenant_id=p_tenant and l.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'returns',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.sale_returns x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'ledger',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at,x.id),'[]') from public.seller_ledger_entries x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payouts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.requested_at),'[]') from public.payouts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payoutEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.payout_events x where x.tenant_id=p_tenant and x.payout_id in (select id from public.payouts where tenant_id=p_tenant and seller_id=p_seller)),
  'statements',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.number),'[]') from public.settlement_statements x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'statementLines',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.statement_id,x.line_no),'[]') from public.settlement_statement_lines x where x.tenant_id=p_tenant and x.statement_id in (select id from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller)),
  'communications',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.queued_at),'[]') from public.seller_communications x where x.tenant_id=p_tenant and x.seller_id=p_seller)
 );
 perform komisio_private.record_access(p_tenant,'seller.exported',p_seller,jsonb_build_object('items',jsonb_array_length(result->'items'),'ledger',jsonb_array_length(result->'ledger')));
 return result;
end $function$;

-- Transfers prepare reception observations in the target store; acceptance stays explicit.
CREATE OR REPLACE FUNCTION public.transfer_item(p_from uuid, p_item uuid, p_to uuid, p_id uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,'')); item public.items; src public.sellers; dst uuid;
 chain_from uuid; chain_to uuid; from_name text; facts jsonb; prior public.item_events; bag uuid; session uuid; sources jsonb; origin jsonb; title text; carried jsonb;
 detail jsonb; first uuid; second uuid;
begin
 if p_from is null or p_to is null or p_item is null or p_id is null or p_from=p_to or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Lock both stores in a fixed order so two opposite transfers cannot deadlock.
 if p_from<p_to then first:=p_from; second:=p_to; else first:=p_to; second:=p_from; end if;
 perform 1 from public.tenants where id=first for update;
 perform 1 from public.tenants where id=second for update;
 if coalesce(public.tenant_role(p_from),'') not in ('owner','admin') or coalesce(public.tenant_role(p_to),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select chain_id,name into chain_from,from_name from public.tenants where id=p_from;
 select chain_id into chain_to from public.tenants where id=p_to;
 if chain_from is null or chain_to is distinct from chain_from then raise exception 'NOT_SAME_CHAIN'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id<>p_from or prior.item_id<>p_item or prior.kind<>'period_ended' or prior.actor<>uid or prior.detail->>'action' is distinct from 'transfer' then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('transferred',true,'replayed',true,'toTenant',prior.detail->>'toTenant','sellerId',prior.detail->>'sellerId','bagId',prior.detail->>'bagId','sessionId',prior.detail->>'sessionId');
 end if;
 select * into item from public.items where tenant_id=p_from and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.ownership<>'consignment' or item.seller_id is null then raise exception 'TRANSFER_UNSUPPORTED'; end if;
 facts:=komisio_private.item_lifecycle(p_from,p_item);
 if (facts->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (facts->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 select * into src from public.sellers where tenant_id=p_from and id=item.seller_id;
 -- The same person in the target store: matched by e-mail, else by phone; otherwise copied.
 if src.email<>'' then select id into dst from public.sellers where tenant_id=p_to and lower(email)=lower(src.email) order by created_at limit 1; end if;
 if dst is null and src.phone<>'' then select id into dst from public.sellers where tenant_id=p_to and phone=src.phone order by created_at limit 1; end if;
 if dst is null then
  dst:=gen_random_uuid();
  insert into public.sellers(id,tenant_id,name,email,phone,created_by) values(dst,p_to,src.name,src.email,src.phone,uid);
  perform komisio_private.record_access(p_to,'seller.registered',dst,jsonb_build_object('via','transfer','from_tenant',p_from));
 end if;
 origin:=komisio_private.item_title(p_from,p_item);
 title:=coalesce(origin->>'title','Transferred item');
 -- Carry current facts as observations for destination staff to review.
 -- Existing approvals and balances do not travel with the item.
 carried:=(select coalesce(jsonb_agg(a-'source'-'accepted'-'correctedBy'-'correctedAt'-'reason'),'[]'::jsonb)
  from jsonb_array_elements(komisio_private.item_attributes(p_from,p_item)) a
  where exists(select 1 from public.attribute_definitions f where f.slug=a->>'slug' and f.version=(a->>'definitionVersion')::integer and (f.tenant_id is null or f.tenant_id=p_to)));
 bag:=gen_random_uuid(); session:=gen_random_uuid();
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by)
 values(bag,p_to,dst,left('Transfer from '||from_name||' (item '||p_item::text||')'||case when note<>'' then ': '||note else '' end,500),uid);
 perform public.create_bag_reception(p_to,session,dst,bag);
 sources:=(select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'kind','observation','reference',a->>'slug','observation',a->>'value')),'[]'::jsonb) from jsonb_array_elements(carried) a);
 if sources='[]'::jsonb then sources:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind','observation','reference','description','observation',left(title,1000))); end if;
 perform public.save_reception_sources(p_to,gen_random_uuid(),session,0,sources);
 detail:=jsonb_build_object('action','transfer','note',note,'toTenant',p_to,'sellerId',dst,'bagId',bag,'sessionId',session);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_from,p_item,'period_ended',detail,uid);
 perform komisio_private.record_access(p_from,'item.transferred_out',p_item,jsonb_build_object('to_tenant',p_to,'bag_id',bag));
 perform komisio_private.record_access(p_to,'item.transferred_in',bag,jsonb_build_object('from_tenant',p_from,'item_id',p_item,'session_id',session));
 return jsonb_build_object('transferred',true,'replayed',false,'toTenant',p_to,'sellerId',dst,'bagId',bag,'sessionId',session);
end $function$
;

CREATE OR REPLACE FUNCTION public.quick_receive(p_tenant uuid, p_request uuid, p_session uuid, p_seller uuid, p_expected integer, p_facts jsonb, p_price_ore bigint, p_item_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; attrs jsonb:='[]'::jsonb; k text; v text; ver integer; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_seller is null or p_expected is null or p_expected<0 or p_expected>=2147483646
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999 or p_facts is null or jsonb_typeof(p_facts)<>'object' or not (p_facts ? 'description') then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 if coalesce(pol->>'intakeProfile','quick')='full' and not exists(select 1 from public.reception_sessions where tenant_id=p_tenant and id=p_session and bag_id is not null) then raise exception 'INTAKE_PROFILE_FULL'; end if;
 select * into sess from public.reception_sessions where tenant_id=p_tenant and id=p_session;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 if sess.seller_id<>p_seller then raise exception 'RECEPTION_SESSION_SELLER'; end if;
 select * into existing from public.items where tenant_id=p_tenant and origin_kind='reception_review' and origin_id=p_session;
 if found then
  -- The same garment again (a retried request): the item already exists.
  select id into garment_id from public.garment_receipts where tenant_id=p_tenant and session_id=p_session;
  return jsonb_build_object('itemId',existing.id,'reference','I-'||upper(left(existing.id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',existing.origin_revision);
 end if;
 select * into src from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if coalesce(src.revision,0)<>p_expected then raise exception 'RECEPTION_CHANGED'; end if;
 -- Any attribute the store can see, not a fixed list of seven: that is what
 -- lets a lamp record its socket. The definition must exist, which is what
 -- keeps the vocabulary from growing by typing.
 for k in select * from jsonb_object_keys(p_facts) loop
  if jsonb_typeof(p_facts->k)<>'string' or k !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from public.attribute_definitions d where d.slug=k and (d.tenant_id is null or d.tenant_id=p_tenant)) then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
 end loop;
 if p_item_type is not null and not exists(select 1 from public.item_types t where t.slug=p_item_type and (t.tenant_id is null or t.tenant_id=p_tenant)) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 price_source:=komisio_private.derived_uuid(p_request::text||':price');
 sources:=coalesce(src.sources,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',price_source::text,'kind','price-evidence','reference','Staff','observation','Quick reception: price set by staff'));
 perform public.save_reception_sources(p_tenant,komisio_private.derived_uuid(p_request::text||':sources'),p_session,p_expected,sources);
 select value->>'id' into photo_source from jsonb_array_elements(sources) value where value->>'kind'='photo' limit 1;
 for k in select * from jsonb_object_keys(p_facts) loop
  v:=trim(p_facts->>k);
  if v='' then continue; end if;
  if length(v)>1000 then raise exception 'INVALID_INPUT'; end if;
  -- The newest version the store sees: an observation binds to the meaning
  -- that was current when it was made.
  select max(d.version) into ver from public.attribute_definitions d
   where d.slug=k and (d.tenant_id is null or d.tenant_id=p_tenant)
     and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=k and o.tenant_id=p_tenant));
  attrs:=attrs||jsonb_build_array(jsonb_build_object('slug',k,'definitionVersion',ver,'value',v,
   'sourceIds',jsonb_build_array(coalesce(photo_source,price_source::text)),'certainty','observed'));
 end loop;
 if not exists(select 1 from jsonb_array_elements(attrs) a where a->>'slug'='description') then raise exception 'INVALID_INPUT'; end if;
 -- metadata stays empty; publish_reception_review derives it from the list so
 -- the two can never be written out of step.
 suggestions:=jsonb_build_object('attributes',attrs,
  'price',jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'amount',to_char(p_price_ore/100.0,'FM999999990.00'),'rationale','Set by staff at quick reception','sourceIds',jsonb_build_array(price_source::text)),
  'questions','[]'::jsonb)||(case when p_item_type is null then '{}'::jsonb else jsonb_build_object('itemType',p_item_type) end);
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select * into latest_review from public.reception_reviews where tenant_id=p_tenant and session_id=p_session order by version desc limit 1;
 review_id:=public.publish_reception_review(p_tenant,komisio_private.derived_uuid(p_request::text||':review'),p_session,p_expected+1,latest_review.id,agreement,suggestions,now()+interval '1 day');
 select version into review_version from public.reception_reviews where id=review_id;
 garment_id:=public.receive_garment(p_tenant,komisio_private.derived_uuid(p_request::text||':garment'),p_session,'');
 item_id:=public.accept_item(p_tenant,komisio_private.derived_uuid(p_request::text||':item'),'reception_review',p_session,review_version,p_price_ore);
 perform komisio_private.record_access(p_tenant,'item.quick_received',item_id,jsonb_build_object('session_id',p_session,'price_ore',p_price_ore,'photo',photo_source is not null));
 return jsonb_build_object('itemId',item_id,'reference','I-'||upper(left(item_id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',review_version);
end $function$
;

drop function public.save_inspection_draft(p_tenant uuid, p_request uuid, p_bag uuid, p_draft uuid, p_expected integer, p_description text, p_category text, p_condition text, p_attributes jsonb);

drop function public.set_inspection_archived(p_tenant uuid, p_request uuid, p_bag uuid, p_draft uuid, p_expected integer, p_archived boolean, p_reason text);

drop function komisio_private.op_execute_save_inspection_draft(p_tenant uuid, p_operation uuid, p_payload jsonb);

drop function komisio_private.op_preflight_save_inspection_draft(p_tenant uuid, p_payload jsonb);

drop function komisio_private.op_validate_save_inspection_draft(value jsonb);

drop view public.inspection_current;
drop table public.inspection_draft_revisions;
drop function komisio_private.preserve_inspection_revision();

CREATE OR REPLACE FUNCTION komisio_private.connector_scopes()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$

 select array['reception:read','reception:preview','reception:propose','items:read','items:propose','economy:read','sales:read','sales:propose','ledger:propose','lifecycle:propose','communications:propose','payouts:propose','accounting:read','accounting:propose','store:read','store:propose']

$function$
;

-- A retired source has no title to copy: use the existing item reference.
CREATE OR REPLACE FUNCTION komisio_private.item_title(p_tenant uuid, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare attrs jsonb;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then
  return jsonb_build_object('title',null,'category',null,'condition',null);
 end if;
 attrs:=komisio_private.item_attributes(p_tenant,p_item);
 return jsonb_build_object(
  'title',coalesce((select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='description' limit 1),
   (select 'I-'||upper(left(id::text,8)) from public.items where tenant_id=p_tenant and id=p_item and origin_kind='inspection_draft')),
  'category',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='category' limit 1),
  'condition',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='condition' limit 1));
end $function$;
