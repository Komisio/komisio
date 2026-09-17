-- The seven fixed keys leave the reception review (2026-09-17, owner decision
-- now that no external store exists in either environment). The attribute list
-- has been the truth since the second slice and metadata was derived from it
-- on every write. Keeping both cost a rule that refuses a payload where they
-- disagree, a derivation in each direction, and one real bug where an edit of
-- the derived field silently changed nothing.
--
-- A review carries attributes and nothing else now. Rows written before this
-- keep their metadata key: reception_reviews is append-only and a check
-- constraint is not re-run over rows nobody touches, so history stays readable
-- exactly as it was published.

create or replace function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare price jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 -- metadata is still tolerated on a row written before this migration; it is
 -- never required and never read.
 if not(value ?& array['attributes','price','questions']) or (value-array['attributes','price','questions','itemType','metadata'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 if value ? 'itemType' and (jsonb_typeof(value->'itemType')<>'string' or (value->>'itemType') !~ '^[a-z][a-z0-9_]{0,39}$') then return false; end if;
 if not komisio_private.valid_item_attributes(value->'attributes') then return false; end if;
 if not exists(select 1 from jsonb_array_elements(value->'attributes') a where a->>'slug'='description') then return false; end if;
 -- Publication is where evidence is required: every observation a seller is
 -- asked to approve cites the photo or the note it came from.
 if exists(select 1 from jsonb_array_elements(value->'attributes') a where not komisio_private.valid_reception_refs(a->'sourceIds')) then return false; end if;
 price:=value->'price';
 if jsonb_typeof(price)<>'object' then return false; end if;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;

create or replace function public.publish_reception_review(p_tenant uuid,p_request uuid,p_session uuid,p_source_revision integer,p_previous uuid,p_agreement uuid,p_suggestions jsonb,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text; sug jsonb; attr jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 -- Nothing to normalise: the list is the only shape.
 sug:=p_suggestions;
 select * into prior from public.reception_reviews where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid
   or prior.source_revision is distinct from p_source_revision or prior.previous_review_id is distinct from p_previous
   or prior.agreement_id is distinct from p_agreement or prior.suggestions is distinct from sug or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if sug->'price'->>'currency'<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
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
 for attr in select * from jsonb_array_elements(sug->'attributes') loop
  for ref in select * from jsonb_array_elements_text(attr->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
  -- A published review holds only attributes bound to a definition the store
  -- can see. An assistant's proposal for something undefined stays a proposal
  -- until a person binds it.
  if not exists(select 1 from public.attribute_definitions d
   where d.slug=attr->>'slug' and d.version=(attr->>'definitionVersion')::integer
    and (d.tenant_id is null or d.tenant_id=p_tenant)) then raise exception 'ATTRIBUTE_UNDEFINED' using detail=attr->>'slug'; end if;
 end loop;
 if sug ? 'itemType' and not exists(select 1 from public.item_types t
  where t.slug=sug->>'itemType' and (t.tenant_id is null or t.tenant_id=p_tenant)) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 for ref in select * from jsonb_array_elements_text(sug->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,sug,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $$;

create or replace function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; out jsonb:='[]'::jsonb; d record; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select coalesce(suggestions->'attributes','[]'::jsonb) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  select description,category,condition,attributes into d from public.inspection_draft_revisions
   where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
  -- A draft written with a list keeps it; one written before the column
  -- existed still answers with its three columns.
  if jsonb_array_length(coalesce(d.attributes,'[]'::jsonb))>0 then
   out:=d.attributes;
  else
   out:=(select coalesce(jsonb_agg(jsonb_build_object('slug',s,'definitionVersion',1,'value',v,'sourceIds','[]'::jsonb,'certainty','observed')),'[]'::jsonb)
         from (values('description',d.description),('category',d.category),('condition',d.condition)) as f(s,v)
         where nullif(trim(coalesce(v,'')),'') is not null);
  end if;
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
end $$;

-- The seller keeps the labelled, ordered list; only where it comes from
-- changes. The flat map beside it is what the page has always rendered.
create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review_read(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb; facts jsonb; lang text;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 lang:=coalesce(terms.language,'en');
 facts:=coalesce(review.suggestions->'attributes','[]'::jsonb);
 select jsonb_object_agg(a->>'slug',a->>'value') into metadata from jsonb_array_elements(facts) a;
 return jsonb_build_object('reviewId',review.id,'version',review.version,'storeName',(select name from public.tenants where id=review.tenant_id),
  'metadata',coalesce(metadata,'{}'::jsonb),
  'facts',(select coalesce(jsonb_agg(jsonb_build_object(
     'slug',a->>'slug','value',a->>'value',
     'label',coalesce((select d.labels->>lang from public.attribute_definitions d
       where d.slug=a->>'slug' and (d.tenant_id is null or d.tenant_id=review.tenant_id)
       order by (d.tenant_id is not null) desc, d.version desc limit 1),
      (select d.labels->>'en' from public.attribute_definitions d
       where d.slug=a->>'slug' and (d.tenant_id is null or d.tenant_id=review.tenant_id)
       order by (d.tenant_id is not null) desc, d.version desc limit 1),
      a->>'slug'))),'[]'::jsonb) from jsonb_array_elements(facts) a),
  'price',(review.suggestions->'price') - 'sourceIds','expiresAt',review.expires_at,'photos',to_jsonb(review.photo_sources),
  'terms',jsonb_build_object('versionId',terms.id,'title',terms.title,'body',terms.body,'language',terms.language),
  'response',case when response.id is null then null else jsonb_build_object('decision',response.decision,'createdAt',response.created_at) end);
end $$;

create or replace function public.quick_receive(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_item_type text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; attrs jsonb:='[]'::jsonb; k text; v text; ver integer; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_seller is null or p_expected is null or p_expected<0 or p_expected>=2147483646
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999 or p_facts is null or jsonb_typeof(p_facts)<>'object' or not (p_facts ? 'description') then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 if coalesce(pol->>'intakeProfile','quick')='full' then raise exception 'INTAKE_PROFILE_FULL'; end if;
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
end $$;

-- The derivation in both directions and the list of seven have no callers left.
drop function if exists komisio_private.normalise_review(jsonb);
drop function if exists komisio_private.attributes_to_metadata(jsonb);
drop function if exists komisio_private.metadata_to_attributes(jsonb);
drop function if exists komisio_private.legacy_metadata_slugs();

-- The response shape lost the seven fixed keys, so the prompt is a different
-- contract and moves to version three. Version two stays valid: attempts
-- recorded under it are history and are not rewritten.
create or replace function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $body$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz; s public.platform_settings; est bigint; p text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_revision is null or p_revision<1
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$'
  or (p_prompt is null or p_prompt not in ('reception-v1','reception-v2','reception-v3','reception-batch-v1','reception-batch-v2','reception-batch-v3')) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_assistance_attempts where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.source_revision is distinct from p_revision
   or prior.created_by is distinct from uid or prior.model is distinct from p_model or prior.prompt_version is distinct from p_prompt then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 select revision into latest from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if latest is distinct from p_revision then raise exception 'RECEPTION_CHANGED'; end if;
 moment:=clock_timestamp();
 if exists(select 1 from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '20 seconds')
  or (select count(*) from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
 values(p_request,p_tenant,p_session,p_revision,uid,p_model,p_prompt,moment);
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections c where c.tenant_id=p_tenant) then
  p:=komisio_private.usage_period(moment);
  est:=case when p_prompt like 'reception-batch-%' then s.ai_reserve_batch_ore else s.ai_reserve_ore end;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,p);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED' using errcode='55000'; end if;
  if fund='included' and komisio_private.ai_cap_used(p)+est>s.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED' using errcode='55000'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,p,'attempt:'||p_request,p_model,uid);
 end if;
 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));
 return true;
end $body$;

-- The provenance event records which facts were observed and which were a
-- guess. It read the seven fixed keys, so with those gone it would have frozen
-- an empty record beside every item accepted from now on. It reads the
-- attribute list instead, which is the same question asked of the shape that
-- still exists.
create or replace function komisio_private.item_provenance(p_tenant uuid,p_origin_kind text,p_origin_id uuid) returns jsonb
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
  select coalesce(jsonb_object_agg(a->>'slug',to_jsonb(a->>'certainty')),'{}'::jsonb) into facts from jsonb_array_elements(coalesce(review.suggestions->'attributes','[]'::jsonb)) a;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'model',a.model,'promptVersion',a.prompt_version,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb) into attempts
   from public.reception_assistance_attempts a where a.tenant_id=p_tenant and a.session_id=p_origin_id and a.source_revision=review.source_revision;
  return jsonb_build_object('originKind',p_origin_kind,'reviewedBy',review.created_by,'reviewedAt',review.created_at,'reviewId',review.id,'version',review.version,'sourceRevision',review.source_revision,
   'facts',facts,'priceSourceIds',review.suggestions->'price'->'sourceIds','modelAttempts',attempts,'stagedOperation',staged);
 else
  return jsonb_build_object('originKind',p_origin_kind);
 end case;
end $$;

-- An agent's proposal is checked before it is queued, and that check walked
-- the seven fixed keys. With those gone it would have walked nothing, so a
-- proposal citing evidence that does not exist would have reached the queue
-- unchallenged. It walks the attribute list instead.
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
 for fact in select * from jsonb_array_elements(coalesce(p_payload->'suggestions'->'attributes','[]'::jsonb)) loop
  for ref in select * from jsonb_array_elements_text(fact->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
 end loop;
 for ref in select * from jsonb_array_elements_text(p_payload->'suggestions'->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 return jsonb_build_object('session_id',sid);
end $$;
