-- Reuse immutable agreement evidence without granting sellers raw table access.
alter table public.seller_agreement_evidence add column source text not null default 'staff_recorded'
 check(source in ('staff_recorded','seller_portal'));

create function public.my_seller_agreement(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare agreement public.seller_agreement_versions; evidence public.seller_agreement_evidence;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 select * into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if agreement.id is null then return jsonb_build_object('agreement',null,'acceptance',null); end if;
 select * into evidence from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=agreement.id order by recorded_at desc,id desc limit 1;
 return jsonb_build_object('agreement',jsonb_build_object('id',agreement.id,'version',agreement.version,'title',agreement.title,'body',agreement.body,'language',agreement.language),
  'acceptance',case when evidence.id is null then null else jsonb_build_object('id',evidence.id,'at',evidence.recorded_at,'source',evidence.source) end);
end $$;

create function public.accept_my_seller_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_agreement_evidence; current_id uuid; address text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_agreement is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_agreement_evidence where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller
   or prior.agreement_id is distinct from p_agreement or prior.recorded_by is distinct from uid
   or prior.source<>'seller_portal' then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.id;
 end if;
 select id into current_id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_id is null or current_id is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into prior from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=p_agreement and recorded_by=uid and source='seller_portal'
 order by recorded_at,id limit 1;
 if found then return prior.id; end if;
 select lower(trim(email)) into address from auth.users where id=uid;
 insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,source)
 values(p_id,p_tenant,p_agreement,p_seller,address,uid,'seller_portal');
 perform komisio_private.record_access(p_tenant,'agreement.accepted_by_seller',p_id,jsonb_build_object('agreementId',p_agreement,'sellerId',p_seller));
 return p_id;
end $$;
revoke all on function public.my_seller_agreement(uuid,uuid),public.accept_my_seller_agreement(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.my_seller_agreement(uuid,uuid),public.accept_my_seller_agreement(uuid,uuid,uuid,uuid) to authenticated;

-- Preserve the original evidence source in newly accepted items.
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
end $$;
