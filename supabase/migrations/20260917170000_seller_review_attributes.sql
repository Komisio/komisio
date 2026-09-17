-- The seller sees everything that was recorded (2026-09-17). read_seller_review
-- built its list from the seven fixed keys, so a lamp's socket and its height
-- never reached the person being asked to approve the item. They approved a
-- description that omitted half of what the store had written down.
--
-- The list is read where the review has one, and the seven keys where it does
-- not. Labels come with it, in the language of the terms the seller is reading,
-- so an attribute the store defined is named rather than shown as a slug.
-- Order is the order it was recorded in, which jsonb_object_agg could not keep.
create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review_read(p_token); terms public.seller_agreement_versions;
 response public.reception_responses; metadata jsonb; facts jsonb; lang text;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 lang:=coalesce(nullif(terms.language,''),'sv');
 facts:=coalesce(review.suggestions->'attributes',komisio_private.metadata_to_attributes(review.suggestions->'metadata'));
 -- Kept for the flat map the page has always rendered; the ordered list below
 -- is what a reader should prefer.
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
