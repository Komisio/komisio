-- P1 S4: one item, three origins (docs/INTAKE-CONVERGENCE.md). accept_item is the
-- single command that turns an inspection draft, a reception review or a purchase
-- receipt into an item with frozen terms. Origins stay the evidence; the item
-- references their exact revision and never copies their text. Immutable.
create table public.items (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 origin_kind text not null check(origin_kind in ('inspection_draft','reception_review','purchase')),
 origin_id uuid not null,
 origin_revision integer check(origin_revision>0),
 response_id uuid,
 custody_kind text check(custody_kind in ('bag','garment')),
 custody_id uuid,
 seller_id uuid,
 ownership text not null check(ownership in ('consignment','store')),
 terms jsonb not null check(jsonb_typeof(terms)='object'),
 accepted_by uuid not null references auth.users(id),
 accepted_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,origin_kind,origin_id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 check((origin_kind='purchase')=(seller_id is null)),
 check((origin_kind='purchase')=(custody_kind is null)),
 check((origin_kind='purchase')=(origin_revision is null)),
 check((custody_kind is null)=(custody_id is null)),
 check((ownership='store')=(origin_kind='purchase'))
);
create index items_tenant on public.items(tenant_id,accepted_at desc,id);
create index items_seller on public.items(tenant_id,seller_id,accepted_at desc);
create table public.item_prices (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 price_ore bigint not null check(price_ore>0 and price_ore<=99999999999),
 reason text not null check(reason in ('accepted')),
 set_by uuid not null references auth.users(id),
 set_at timestamptz not null default now(),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create index item_prices_item on public.item_prices(tenant_id,item_id,set_at desc);
create table public.item_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 kind text not null check(kind in ('accepted','price_set')),
 detail jsonb not null default '{}'::jsonb,
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create index item_events_item on public.item_events(tenant_id,item_id,occurred_at,id);
alter table public.items enable row level security;
alter table public.item_prices enable row level security;
alter table public.item_events enable row level security;
create policy items_read on public.items for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy item_prices_read on public.item_prices for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy item_events_read on public.item_events for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.items,public.item_prices,public.item_events from public,anon,authenticated;
grant select on public.items,public.item_prices,public.item_events to authenticated;
create function komisio_private.preserve_item() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_ITEM' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_item() from public,anon,authenticated;
create trigger items_immutable before update or delete on public.items for each row execute function komisio_private.preserve_item();
create trigger item_prices_immutable before update or delete on public.item_prices for each row execute function komisio_private.preserve_item();
create trigger item_events_immutable before update or delete on public.item_events for each row execute function komisio_private.preserve_item();

create function public.accept_item(p_tenant uuid,p_id uuid,p_origin_kind text,p_origin_id uuid,p_origin_revision integer,p_price_ore bigint) returns uuid
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
 -- The tenant row lock above serializes acceptances, so this check is a race guard, not a hint.
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
  -- A session, photos or a seller approval never prove custody (A1).
  select * into garment from public.garment_receipts where tenant_id=p_tenant and session_id=p_origin_id;
  if not found then raise exception 'CUSTODY_REQUIRED'; end if;
  seller:=sess.seller_id; custody_kind:='garment'; custody_id:=garment.id;
  select * into resp from public.reception_responses where tenant_id=p_tenant and review_id=review.id;
  if found and resp.decision='approve' then response:=resp.id; evidence_kind:='seller_response'; evidence_id:=resp.id; evidenced_agreement:=review.agreement_id; end if;
  -- Delegated pricing needs no per-item answer (A3); per_item demands the seller's approval of this exact review and price.
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
 -- An origin without its own evidence may still rest on staff-recorded evidence for the current agreement.
 if seller is not null and evidence_kind='none' and current_agreement is not null then
  select id into evidence_id from public.seller_agreement_evidence where tenant_id=p_tenant and seller_id=seller and agreement_id=current_agreement order by recorded_at desc limit 1;
  if evidence_id is not null then evidence_kind:='staff_recorded'; evidenced_agreement:=current_agreement; end if;
 end if;
 -- One agreement prerequisite for every consignment origin, decided by policy (A2).
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
 perform komisio_private.record_access(p_tenant,'item.accepted',p_id,jsonb_build_object('originKind',p_origin_kind,'originId',p_origin_id));
 return p_id;
end $$;
revoke all on function public.accept_item(uuid,uuid,text,uuid,integer,bigint) from public,anon;
grant execute on function public.accept_item(uuid,uuid,text,uuid,integer,bigint) to authenticated;
