-- Seller reads (review page, photo descriptor, Storage policy) no longer take the
-- tenant row lock; only the seller's response does. The read function is STABLE,
-- which makes SELECT ... FOR UPDATE impossible inside it by PostgreSQL rule.
create function komisio_private.seller_review_read(p_token text) returns public.reception_reviews
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); access public.reception_access_events; review public.reception_reviews; address text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into access from public.reception_access_events where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'REVIEW_UNAVAILABLE'; end if;
 if exists(select 1 from public.reception_access_events where review_id=access.review_id and version>access.version) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into review from public.reception_reviews where id=access.review_id;
 select lower(trim(email)) into address from auth.users where id=uid;
 if address is distinct from lower(trim(review.seller_email)) or review.expires_at<=now()
  or exists(select 1 from public.reception_reviews where session_id=review.session_id and version>review.version)
  or exists(select 1 from public.reception_source_revisions where session_id=review.session_id and revision>review.source_revision) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 return review;
end $$;

-- The locking variant is kept for the response only: it serializes with staff
-- replacement/revocation, then rechecks everything under the lock.
create or replace function komisio_private.seller_review(p_token text) returns public.reception_reviews
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); access public.reception_access_events;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into access from public.reception_access_events where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'REVIEW_UNAVAILABLE'; end if;
 perform 1 from public.tenants where id=access.tenant_id for update;
 return komisio_private.seller_review_read(p_token);
end $$;

create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review_read(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 select jsonb_object_agg(k,v->>'value') into metadata from jsonb_each(review.suggestions->'metadata') as facts(k,v);
 return jsonb_build_object('reviewId',review.id,'version',review.version,'storeName',(select name from public.tenants where id=review.tenant_id),
  'metadata',metadata,'price',(review.suggestions->'price') - 'sourceIds','expiresAt',review.expires_at,'photos',to_jsonb(review.photo_sources),
  'terms',jsonb_build_object('versionId',terms.id,'title',terms.title,'body',terms.body,'language',terms.language),
  'response',case when response.id is null then null else jsonb_build_object('decision',response.decision,'createdAt',response.created_at) end);
end $$;

create or replace function public.read_seller_review_photo(p_token text,p_photo uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review_read(p_token);
begin
 if p_photo is null or not(p_photo=any(review.photo_sources)) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 return review.tenant_id::text||'/'||review.session_id::text||'/'||p_photo::text||'.jpg';
end $$;

create or replace function public.seller_reception_photo_access(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare token text; review public.reception_reviews;
begin
 if not storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) then return false; end if;
 token:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-komisio-review-token';
 if token is null or token !~ '^[a-f0-9]{64}$' then return false; end if;
 review:=komisio_private.seller_review_read(token);
 return exists(select 1 from unnest(review.photo_sources) photo where p_path=review.tenant_id::text||'/'||review.session_id::text||'/'||photo::text||'.jpg');
exception when others then return false;
end $$;
revoke all on function komisio_private.seller_review_read(text) from public,anon,authenticated;
