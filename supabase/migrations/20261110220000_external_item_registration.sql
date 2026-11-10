alter table public.external_item_guarantee_events add column registration_hash text
 check(registration_hash is null or (kind='registered' and registration_hash ~ '^[a-f0-9]{64}$'));

create function komisio_private.external_reception_guarantee(p_tenant uuid,p_session uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select g.id from public.external_item_guarantees g join public.reception_sessions s
  on s.tenant_id=g.tenant_id and s.seller_id=g.seller_id and s.bag_id=g.bag_id
 where g.tenant_id=p_tenant and s.id=p_session and s.id=komisio_private.derived_id(g.id::text||':reception');
$$;
revoke all on function komisio_private.external_reception_guarantee(uuid,uuid) from public,anon,authenticated;

create function public.prepare_external_item_registration(p_tenant uuid,p_guarantee uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); g public.external_item_guarantees; sid uuid; request public.external_item_requests;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into g from public.external_item_guarantees where tenant_id=p_tenant and id=p_guarantee;
 if g.id is null then raise exception 'GUARANTEE_NOT_FOUND'; end if;
 sid:=komisio_private.derived_id(g.id::text||':reception');
 if not exists(select 1 from public.reception_sessions where id=sid) then
  perform public.create_bag_reception(p_tenant,sid,g.seller_id,g.bag_id);
 end if;
 if komisio_private.external_reception_guarantee(p_tenant,sid) is distinct from g.id then raise exception 'REQUEST_CONFLICT'; end if;
 select r.* into request from public.external_item_requests r join public.external_item_offers o on o.request_id=r.id and o.tenant_id=r.tenant_id where o.id=g.offer_id;
 return jsonb_build_object('sessionId',sid,'ownerId',g.owner_id,'photoIds',request.photos,
  'itemId',(select item_id from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered'));
end $$;

-- The same published-review validator remains in charge of source and attribute
-- evidence. Only an explicitly guarantee-bound reception may keep old terms.
do $$ declare definition text; needle text:='if current_agreement is distinct from p_agreement then raise exception ''AGREEMENT_CHANGED''; end if;'; begin
 definition:=pg_get_functiondef('public.publish_reception_review(uuid,uuid,uuid,integer,uuid,uuid,jsonb,timestamptz)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_REVIEW_FUNCTION'; end if;
 execute replace(definition,needle,
  'if current_agreement is distinct from p_agreement and not exists(select 1 from public.external_item_guarantees g
    join public.external_item_handover_links l on l.id=g.handover_link_id and l.tenant_id=g.tenant_id
    where g.id=komisio_private.external_reception_guarantee(p_tenant,p_session) and l.agreement_id=p_agreement)
   then raise exception ''AGREEMENT_CHANGED''; end if;');
end $$;

create or replace function komisio_private.require_guaranteed_item_intake() returns trigger
language plpgsql set search_path='' as $$
declare g public.external_item_guarantees; link public.external_item_handover_links;
begin
 if not exists(select 1 from public.sellers s where s.tenant_id=new.tenant_id and s.id=new.seller_id and s.external_owner_id is not null) then
  if new.terms ? 'externalGuarantee' then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
  return new;
 end if;
 select * into g from public.external_item_guarantees where tenant_id=new.tenant_id and id::text=new.terms#>>'{externalGuarantee,id}';
 if g.id is null then raise exception 'GUARANTEED_INTAKE_REQUIRED'; end if;
 select * into link from public.external_item_handover_links where id=g.handover_link_id;
 if new.id<>komisio_private.derived_id(g.id::text||':item') or new.seller_id<>g.seller_id or new.ownership<>'consignment'
  or new.origin_kind<>'reception_review' or komisio_private.external_reception_guarantee(new.tenant_id,new.origin_id) is distinct from g.id
  or new.custody_kind<>'garment' or not exists(select 1 from public.garment_receipts r where r.tenant_id=new.tenant_id and r.id=new.custody_id and r.session_id=new.origin_id)
  or new.terms->>'agreementVersionId' is distinct from link.agreement_id::text
  or new.terms->>'evidenceId' is distinct from link.evidence_id::text
  or new.terms->>'evidenceKind' is distinct from 'seller_portal'
  or new.terms->>'endOfPeriodAction' is distinct from 'guaranteed_purchase'
  or new.terms->>'salePeriodDays' is distinct from '45'
  or new.terms ?| array['commissionBasis','commissionRatePercent','sellerTermsId','sellerTermsVersion']
  or new.terms->'externalGuarantee' is distinct from jsonb_build_object('id',g.id,'amountOre',g.amount_ore::text,'currency',g.currency,'receivedAt',g.received_at,'dueAt',g.due_at)
 then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 -- Earlier item triggers may have projected ordinary receipt/collection terms.
 new.terms:=new.terms-array['consignmentPeriod','collectionDays'];
 return new;
end $$;

create function komisio_private.require_external_registration_link() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.terms ? 'externalGuarantee' and not exists(select 1 from public.external_item_guarantee_events e
  where e.tenant_id=new.tenant_id and e.item_id=new.id and e.guarantee_id::text=new.terms#>>'{externalGuarantee,id}' and e.kind='registered'
   and e.recorded_by=new.accepted_by and e.registration_hash is not null)
 then raise exception 'GUARANTEE_REGISTRATION_REQUIRED'; end if;
 return null;
end $$;
revoke all on function komisio_private.require_external_registration_link() from public,anon,authenticated;
create constraint trigger guarantee_registration_required after insert on public.items deferrable initially deferred
 for each row when (new.terms ? 'externalGuarantee') execute function komisio_private.require_external_registration_link();

create function public.register_external_item(p_tenant uuid,p_id uuid,p_guarantee uuid,p_description text,p_price_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); g public.external_item_guarantees; link public.external_item_handover_links;
 prior public.external_item_guarantee_events; request public.external_item_requests; sid uuid; iid uuid; garment uuid; review uuid; rev integer;
 source_rev integer; previous uuid; sources jsonb:='[]'; attrs jsonb:='[]'; suggestions jsonb; photo uuid; target text; observation uuid;
 price_source uuid; description text:=trim(coalesce(p_description,'')); digest text; policy_doc jsonb; terms jsonb; origin jsonb; version integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_guarantee is null or length(description) not between 1 and 1000 or p_price_ore is null or p_price_ore not between 1 and 99999999 then raise exception 'INVALID_INPUT'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('guarantee',p_guarantee,'description',description,'priceOre',p_price_ore)::text,'UTF8')),'hex');
 select * into prior from public.external_item_guarantee_events where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.guarantee_id<>p_guarantee or prior.kind<>'registered' or prior.recorded_by<>uid or prior.registration_hash is distinct from digest then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.item_id;
 end if;
 select * into g from public.external_item_guarantees where tenant_id=p_tenant and id=p_guarantee;
 if g.id is null then raise exception 'GUARANTEE_NOT_FOUND'; end if;
 if exists(select 1 from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered') then raise exception 'REQUEST_CHANGED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'CURRENCY_MISMATCH'; end if;
 sid:=komisio_private.derived_id(g.id::text||':reception'); iid:=komisio_private.derived_id(g.id::text||':item');
 if komisio_private.external_reception_guarantee(p_tenant,sid) is distinct from g.id then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into link from public.external_item_handover_links where id=g.handover_link_id;
 select r.* into request from public.external_item_requests r join public.external_item_offers o on o.request_id=r.id and o.tenant_id=r.tenant_id where o.id=g.offer_id;
 foreach photo in array request.photos loop
  target:=p_tenant::text||'/'||sid::text||'/'||photo::text||'.jpg';
  if not exists(select 1 from storage.objects where bucket_id='reception-photos' and name=target)
   or not exists(select 1 from storage.objects where bucket_id='seller-reception-photos' and name=target) then raise exception 'PHOTO_NOT_FOUND'; end if;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',photo,'kind','photo','reference',target,'observation',''));
 end loop;
 observation:=komisio_private.derived_id(p_id::text||':observation'); price_source:=komisio_private.derived_id(p_id::text||':price');
 sources:=sources||jsonb_build_array(
  jsonb_build_object('id',observation,'kind','observation','reference','komisio:central-registration:v1','observation',description),
  jsonb_build_object('id',price_source,'kind','price-evidence','reference','Staff','observation','Selling price confirmed at central registration'));
 select coalesce(max(revision),0) into source_rev from public.reception_source_revisions where tenant_id=p_tenant and session_id=sid;
 perform public.save_reception_sources(p_tenant,komisio_private.derived_id(p_id::text||':sources'),sid,source_rev,sources);
 select max(d.version) into version from public.attribute_definitions d where d.slug='description' and (d.tenant_id is null or d.tenant_id=p_tenant)
  and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=d.slug and o.tenant_id=p_tenant));
 attrs:=jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',version,'value',description,'sourceIds',jsonb_build_array(observation),'certainty','observed'));
 if length(request.brand)>0 then
  select max(d.version) into version from public.attribute_definitions d where d.slug='brand' and (d.tenant_id is null or d.tenant_id=p_tenant)
   and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=d.slug and o.tenant_id=p_tenant));
  if version is not null then attrs:=attrs||jsonb_build_array(jsonb_build_object('slug','brand','definitionVersion',version,'value',request.brand,'sourceIds',jsonb_build_array(request.photos[1]),'certainty','tentative')); end if;
 end if;
 suggestions:=jsonb_build_object('attributes',attrs,'price',jsonb_build_object('currency','SEK','amount',to_char(p_price_ore/100.0,'FM999990.00'),
  'rationale','Set by staff at central registration','sourceIds',jsonb_build_array(price_source)),'questions','[]'::jsonb);
 select r.id into previous from public.reception_reviews r where r.tenant_id=p_tenant and r.session_id=sid order by r.version desc limit 1;
 review:=public.publish_reception_review(p_tenant,komisio_private.derived_id(p_id::text||':review'),sid,source_rev+1,previous,link.agreement_id,suggestions,clock_timestamp()+interval '1 day');
 select r.version into rev from public.reception_reviews r where r.id=review;
 garment:=public.receive_garment(p_tenant,komisio_private.derived_id(g.id::text||':garment'),sid,'');
 policy_doc:=public.current_store_policy(p_tenant);
 origin:=jsonb_build_object('sessionId',sid,'reviewId',review,'version',rev,'sourceRevision',source_rev+1,
  'garmentReference',(select reference from public.garment_receipts where id=garment));
 terms:=jsonb_build_object('ownership','consignment','salePeriodDays',45,'markdownSteps',policy_doc->'policy'->'markdownSteps','endOfPeriodAction','guaranteed_purchase',
  'storePolicyId',policy_doc->'id','storePolicyVersion',policy_doc->'version','agreementVersionId',link.agreement_id,'evidenceKind','seller_portal','evidenceId',link.evidence_id,'origin',origin,
  'externalGuarantee',jsonb_build_object('id',g.id,'amountOre',g.amount_ore::text,'currency',g.currency,'receivedAt',g.received_at,'dueAt',g.due_at));
 insert into public.items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by)
 values(iid,p_tenant,'reception_review',sid,rev,'garment',garment,g.seller_id,'consignment',terms,uid);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,iid,p_price_ore,'accepted',uid);
 insert into public.item_events(tenant_id,item_id,kind,detail,actor) values
  (p_tenant,iid,'accepted',jsonb_build_object('originKind','reception_review')||origin,uid),
  (p_tenant,iid,'price_set',jsonb_build_object('priceOre',p_price_ore,'reason','accepted'),uid),
  (p_tenant,iid,'provenance',komisio_private.item_provenance(p_tenant,'reception_review',sid),uid);
 insert into public.external_item_guarantee_events(id,tenant_id,guarantee_id,kind,item_id,recorded_by,registration_hash)
 values(p_id,p_tenant,g.id,'registered',iid,uid,digest);
 perform komisio_private.record_access(p_tenant,'external_item.registered',iid,jsonb_build_object('guaranteeId',g.id,'sessionId',sid));
 return iid;
end $$;
revoke all on function public.prepare_external_item_registration(uuid,uuid),public.register_external_item(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.prepare_external_item_registration(uuid,uuid),public.register_external_item(uuid,uuid,uuid,text,bigint) to authenticated;

-- Ordinary lifecycle actions cannot change the accepted central promise. Price
-- changes still work; sale/acquisition execution is a separate engine slice.
create function komisio_private.guard_guaranteed_item_event() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind in ('period_extended','period_ended','period_reopened','period_end_corrected','collection_recorded')
  and exists(select 1 from public.items i where i.tenant_id=new.tenant_id and i.id=new.item_id and i.terms ? 'externalGuarantee')
 then raise exception 'GUARANTEED_LIFECYCLE_REQUIRED'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_guaranteed_item_event() from public,anon,authenticated;
create trigger guaranteed_item_event before insert on public.item_events for each row execute function komisio_private.guard_guaranteed_item_event();

do $$ declare definition text; needle text:='terms:=item.terms;'; begin
 definition:=pg_get_functiondef('komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_SALE_FUNCTION'; end if;
 execute replace(definition,needle,'if item.terms ? ''externalGuarantee'' then raise exception ''GUARANTEED_SALE_REQUIRED''; end if; '||needle);
end $$;

-- Inventory reads report the unimplemented financial path as unavailable; they
-- must not attempt percentage accounting or hide the entire item directory.
do $$ declare definition text; needle text:='if sqlerrm=''VAT_MODE_NOT_SET'' then blocked:=''VAT_MODE_NOT_SET''; else raise; end if;'; begin
 definition:=pg_get_functiondef('komisio_private.paypal_item_snapshot(uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_PAYPAL_SNAPSHOT'; end if;
 execute replace(definition,needle,'if sqlerrm in (''VAT_MODE_NOT_SET'',''GUARANTEED_SALE_REQUIRED'') then blocked:=sqlerrm; else raise; end if;');
end $$;

do $$ begin
 execute replace(pg_get_functiondef('komisio_private.item_lifecycle(uuid,uuid)'::regprocedure),
  'FUNCTION komisio_private.item_lifecycle(', 'FUNCTION komisio_private.item_lifecycle_before_guarantees(');
end $$;
revoke all on function komisio_private.item_lifecycle_before_guarantees(uuid,uuid) from public,anon,authenticated;
create or replace function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; g public.external_item_guarantees; step jsonb; idx integer:=0; due_step integer; due_percent numeric;
begin
 facts:=komisio_private.item_lifecycle_before_guarantees(p_tenant,p_item);
 select g0.* into g from public.external_item_guarantees g0 join public.external_item_guarantee_events e on e.tenant_id=g0.tenant_id and e.guarantee_id=g0.id
  where e.tenant_id=p_tenant and e.item_id=p_item and e.kind='registered';
 if g.id is null then return facts; end if;
 for step in select * from jsonb_array_elements(facts->'steps') loop
  idx:=idx+1;
  if due_step is null and not(facts->'appliedSteps' @> to_jsonb(idx)) and g.received_at+(step->>'afterDays')::integer*interval '24 hours'<=now() then
   due_step:=idx; due_percent:=(step->>'percent')::numeric;
  end if;
 end loop;
 return facts||jsonb_build_object('periodEnd',g.due_at,'receivedAt',g.received_at,'endOfPeriodAction',null,'collectionDeadline',null,
  'extensionDays',0,'dueStep',due_step,'duePercent',due_percent,
  'stage',case when (facts->>'sold')::boolean then 'sold' when (facts->>'ended')::boolean then 'ended'
   when g.due_at<=now() then 'period_ended' when due_step is not null then 'markdown_due'
   when g.due_at<=now()+interval '7 days' then 'period_ending' else 'on_sale' end);
end $$;

do $$ declare definition text; needle text:='''creditedAt'',(select l.occurred_at'; begin
 definition:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_GUARANTEE_READ'; end if;
 execute replace(definition,needle,
  '''itemId'',(select e.item_id from public.external_item_guarantee_events e where e.guarantee_id=g.id and e.kind=''registered''),
   ''registeredAt'',(select e.recorded_at from public.external_item_guarantee_events e where e.guarantee_id=g.id and e.kind=''registered''),
   '||needle);
end $$;
