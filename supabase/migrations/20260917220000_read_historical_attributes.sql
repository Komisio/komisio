-- Read historical, immutable reviews without rewriting accepted evidence.
create or replace function komisio_private.stored_review_attributes(p_suggestions jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_suggestions ? 'attributes' then p_suggestions->'attributes'
 else coalesce((select jsonb_agg(jsonb_build_object('slug',key,'definitionVersion',1)||value order by key)
 from jsonb_each(coalesce(p_suggestions->'metadata','{}'::jsonb))
 where key in ('description','category','color','brand','size','material','condition')), '[]'::jsonb) end
$$;
revoke all on function komisio_private.stored_review_attributes(jsonb) from public,anon,authenticated;

create or replace function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; out jsonb:='[]'::jsonb; d record; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select komisio_private.stored_review_attributes(suggestions) into out
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

create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review_read(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb; facts jsonb; lang text;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 lang:=coalesce(terms.language,'en');
 facts:=komisio_private.stored_review_attributes(review.suggestions);
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
  select coalesce(jsonb_object_agg(a->>'slug',to_jsonb(a->>'certainty')),'{}'::jsonb) into facts from jsonb_array_elements(komisio_private.stored_review_attributes(review.suggestions)) a;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'model',a.model,'promptVersion',a.prompt_version,'createdAt',a.created_at) order by a.created_at),'[]'::jsonb) into attempts
   from public.reception_assistance_attempts a where a.tenant_id=p_tenant and a.session_id=p_origin_id and a.source_revision=review.source_revision;
  return jsonb_build_object('originKind',p_origin_kind,'reviewedBy',review.created_by,'reviewedAt',review.created_at,'reviewId',review.id,'version',review.version,'sourceRevision',review.source_revision,
   'facts',facts,'priceSourceIds',review.suggestions->'price'->'sourceIds','modelAttempts',attempts,'stagedOperation',staged);
 else
  return jsonb_build_object('originKind',p_origin_kind);
 end case;
end $$;
