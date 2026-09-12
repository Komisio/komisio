create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 select jsonb_object_agg(k,v->>'value') into metadata from jsonb_each(review.suggestions->'metadata') as facts(k,v);
 return jsonb_build_object('reviewId',review.id,'version',review.version,'storeName',(select name from public.tenants where id=review.tenant_id),
  'metadata',metadata,'price',(review.suggestions->'price') - 'sourceIds','expiresAt',review.expires_at,
  'terms',jsonb_build_object('versionId',terms.id,'title',terms.title,'body',terms.body,'language',terms.language),
  'response',case when response.id is null then null else jsonb_build_object('decision',response.decision,'createdAt',response.created_at) end);
end $$;

