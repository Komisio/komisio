-- Observations: a reception review carries an attribute list (2026-09-17,
-- second slice of the dynamic attribute design). The seven fixed keys stay
-- readable, but they stop being where the truth lives.
--
-- The attribute list is authoritative. metadata is derived from it on write,
-- so there is never a moment when two fields both claim to be true. A caller
-- that still sends only metadata gets an attribute list derived the other way,
-- which is what keeps the existing reception flow working unchanged while the
-- readers move over.
--
-- An observation binds to a definition version, so editing a definition later
-- cannot change what this observation meant. The published review only holds
-- attributes bound to a definition that the store can see: an assistant's
-- proposal for something with no definition yet stays a proposal until a
-- person binds it, which is the line the review of the design asked for.
-- The first slice seeded eleven definitions and missed one: `category`
-- travels inside the reception metadata like any other fact, so without a
-- definition for it every derived attribute list names a slug nothing defines.
-- It stays a separate concept at the product level, suggested by the item type
-- and used for navigation and reports; this row is only how it is stored.
insert into public.attribute_definitions(tenant_id,slug,version,data_type,labels,help) values
 (null,'category',1,'text','{"sv":"Kategori","en":"Category"}'::jsonb,'{"sv":"För navigering och rapporter. Varutypen föreslår en.","en":"For navigation and reports. The item type suggests one."}'::jsonb)
 on conflict do nothing;
insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort) values
 (null,'sweater','category',false,0),
 (null,'lamp','category',false,0)
 on conflict do nothing;

create function komisio_private.valid_item_attributes(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; slugs text[]:='{}';
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value)>100 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' then return false; end if;
  if not(item ?& array['slug','definitionVersion','value','sourceIds','certainty'])
   or (item-array['slug','definitionVersion','value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(item->'slug')<>'string' or (item->>'slug') !~ '^[a-z][a-z0-9_]{0,39}$' then return false; end if;
  if jsonb_typeof(item->'definitionVersion')<>'number' or (item->>'definitionVersion')::numeric<1
   or (item->>'definitionVersion')::numeric<>trunc((item->>'definitionVersion')::numeric) then return false; end if;
  if jsonb_typeof(item->'value')<>'string' or length(trim(item->>'value')) not between 1 and 1000 or length(item->>'value')>1000 then return false; end if;
  -- A published review states what was observed. A guess is held for review
  -- before it gets here, exactly as the seven fixed facts already are.
  if item->>'certainty' is distinct from 'observed' then return false; end if;
  if not komisio_private.valid_reception_refs(item->'sourceIds') then return false; end if;
  if (item->>'slug')=any(slugs) then return false; end if;
  slugs:=slugs||(item->>'slug');
 end loop;
 return true;
end $$;

-- The seven the fixed shape knows. Everything else lives only in the list.
create function komisio_private.legacy_metadata_slugs() returns text[]
language sql immutable set search_path='' as $$ select array['description','category','color','brand','size','material','condition'] $$;

create function komisio_private.attributes_to_metadata(attrs jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare item jsonb; out jsonb:='{}'::jsonb;
begin
 for item in select * from jsonb_array_elements(coalesce(attrs,'[]'::jsonb)) loop
  if (item->>'slug')=any(komisio_private.legacy_metadata_slugs()) then
   out:=out||jsonb_build_object(item->>'slug',jsonb_build_object('value',item->'value','sourceIds',item->'sourceIds','certainty',item->'certainty'));
  end if;
 end loop;
 return out;
end $$;

-- The other direction, for a caller that has not moved yet. The platform
-- definitions for these seven are version 1, which is why the derivation can
-- name a version without looking one up.
create function komisio_private.metadata_to_attributes(metadata jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; out jsonb:='[]'::jsonb;
begin
 for k, v in select * from jsonb_each(coalesce(metadata,'{}'::jsonb)) loop
  out:=out||jsonb_build_array(jsonb_build_object('slug',k,'definitionVersion',1,'value',v->'value','sourceIds',v->'sourceIds','certainty',v->'certainty'));
 end loop;
 return out;
end $$;

-- Whichever side the caller filled, store both, with the list as the source.
create function komisio_private.normalise_review(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare attrs jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return value; end if;
 if value ? 'attributes' then attrs:=value->'attributes'; else attrs:=komisio_private.metadata_to_attributes(value->'metadata'); end if;
 return value||jsonb_build_object('attributes',attrs,'metadata',komisio_private.attributes_to_metadata(attrs));
end $$;

create or replace function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare metadata jsonb; price jsonb; fact jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['metadata','price','questions']) or (value-array['metadata','price','questions','attributes','itemType'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 if value ? 'itemType' and (jsonb_typeof(value->'itemType')<>'string' or (value->>'itemType') !~ '^[a-z][a-z0-9_]{0,39}$') then return false; end if;
 if value ? 'attributes' and not komisio_private.valid_item_attributes(value->'attributes') then return false; end if;
 metadata:=value->'metadata'; price:=value->'price';
 if jsonb_typeof(metadata)<>'object' or jsonb_typeof(price)<>'object' then return false; end if;
 -- metadata never holds a key outside the seven it was built for, which is
 -- what keeps an unknown key an INVALID_INPUT rather than a silent drop.
 if (metadata-komisio_private.legacy_metadata_slugs())<>'{}'::jsonb then return false; end if;
 -- A description is required, but a caller that sends the list puts it there
 -- and leaves metadata for the derivation to fill.
 if value ? 'attributes' then
  if not exists(select 1 from jsonb_array_elements(value->'attributes') a where a->>'slug'='description') then return false; end if;
 elsif not(metadata ? 'description') then
  return false;
 end if;
 for fact in select v from jsonb_each(metadata) as fields(k,v) loop
  if jsonb_typeof(fact)<>'object' then return false; end if;
  if not(fact ?& array['value','sourceIds','certainty']) or (fact-array['value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(fact->'value')<>'string' or length(trim(fact->>'value')) not between 1 and 1000 or length(fact->>'value')>1000
   or fact->>'certainty' is distinct from 'observed' or not komisio_private.valid_reception_refs(fact->'sourceIds') then return false; end if;
 end loop;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;

-- Everything an item is described as, whatever it came from, so no reader has
-- to know about origins. The inspection and purchase paths map their columns
-- onto the same slugs, which is what lets one caller serve all three.
create function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; out jsonb:='[]'::jsonb; d record; note text;
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select coalesce(suggestions->'attributes',komisio_private.metadata_to_attributes(suggestions->'metadata')) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  select description,category,condition into d from public.inspection_draft_revisions
   where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
  out:=(select coalesce(jsonb_agg(jsonb_build_object('slug',s,'definitionVersion',1,'value',v,'sourceIds','[]'::jsonb,'certainty','observed')),'[]'::jsonb)
        from (values('description',d.description),('category',d.category),('condition',d.condition)) as f(s,v)
        where nullif(trim(coalesce(v,'')),'') is not null);
 else
  select supplier_note into note from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  if nullif(trim(coalesce(note,'')),'') is not null then
   out:=jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value',note,'sourceIds','[]'::jsonb,'certainty','observed'));
  end if;
 end if;
 return coalesce(out,'[]'::jsonb);
end $$;
revoke all on function komisio_private.item_attributes(uuid,uuid) from public,anon,authenticated;

-- One item's attributes for a member of the store.
create function public.item_attribute_list(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return null; end if;
 return komisio_private.item_attributes(p_tenant,p_item);
end $$;
revoke all on function public.item_attribute_list(uuid,uuid) from public,anon;
grant execute on function public.item_attribute_list(uuid,uuid) to authenticated;
insert into public.connector_functions(function_name,scope,kind) values('item_attribute_list','items:read','') on conflict do nothing;

create or replace function public.publish_reception_review(p_tenant uuid,p_request uuid,p_session uuid,p_source_revision integer,p_previous uuid,p_agreement uuid,p_suggestions jsonb,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text; sug jsonb; attr jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 -- The list is the truth and metadata is derived from it. Normalising here,
 -- before the replay check, means a replay of the same raw input compares
 -- equal to what was stored rather than raising a false conflict.
 sug:=komisio_private.normalise_review(p_suggestions);
 if not komisio_private.valid_reception_review(sug) then raise exception 'INVALID_INPUT'; end if;
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
