insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('seller-reception-photos','seller-reception-photos',false,1048576,array['image/jpeg']) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='seller-reception-photos' and not public and file_size_limit=1048576 and allowed_mime_types=array['image/jpeg']) then raise exception 'RECEPTION_BUCKET_CONFIG_CONFLICT'; end if;
end $$;

alter table public.reception_reviews add column photo_sources uuid[] not null default '{}';
create function komisio_private.pin_reception_photos() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 select coalesce(array_agg((s->>'id')::uuid order by ord),'{}'::uuid[]) into new.photo_sources
 from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) with ordinality as src(s,ord)
 where r.tenant_id=new.tenant_id and r.session_id=new.session_id and r.revision=new.source_revision and s->>'kind'='photo'
 and exists(select 1 from storage.objects o where o.bucket_id='seller-reception-photos'
  and o.name=new.tenant_id::text||'/'||new.session_id::text||'/'||(s->>'id')||'.jpg');
 return new;
end $$;
revoke all on function komisio_private.pin_reception_photos() from public,anon,authenticated;
create trigger reception_pin_photos before insert on public.reception_reviews for each row execute function komisio_private.pin_reception_photos();

create function public.seller_reception_photo_access(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare token text; review public.reception_reviews;
begin
 -- Storage assigns this operation, not a caller-supplied HTTP header. Fail closed
 -- on older Storage versions; never grant signing/listing with a seller token.
 if current_setting('storage.operation',true) is distinct from 'storage.object.get_authenticated' then return false; end if;
 token:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-komisio-review-token';
 if token is null or token !~ '^[a-f0-9]{64}$' then return false; end if;
 review:=komisio_private.seller_review(token);
 return exists(select 1 from unnest(review.photo_sources) photo where p_path=review.tenant_id::text||'/'||review.session_id::text||'/'||photo::text||'.jpg');
exception when others then return false;
end $$;
revoke all on function public.seller_reception_photo_access(text) from public;
grant execute on function public.seller_reception_photo_access(text) to authenticated,anon;
create policy seller_photo_read on storage.objects for select to authenticated using(bucket_id='seller-reception-photos' and (public.reception_photo_access(name,false) or public.seller_reception_photo_access(name)));
create policy seller_photo_insert on storage.objects for insert to authenticated with check(bucket_id='seller-reception-photos' and name like '%.jpg' and public.reception_photo_access(name,true));
create policy seller_photo_read_boundary on storage.objects as restrictive for select to public using(bucket_id<>'seller-reception-photos' or public.reception_photo_access(name,false) or public.seller_reception_photo_access(name));
create policy seller_photo_insert_boundary on storage.objects as restrictive for insert to public with check(bucket_id<>'seller-reception-photos' or (name like '%.jpg' and public.reception_photo_access(name,true)));
create policy seller_photo_update_boundary on storage.objects as restrictive for update to public using(bucket_id<>'seller-reception-photos') with check(bucket_id<>'seller-reception-photos');
create policy seller_photo_delete_boundary on storage.objects as restrictive for delete to public using(bucket_id<>'seller-reception-photos');

create or replace function public.read_seller_review(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 select jsonb_object_agg(k,v->>'value') into metadata from jsonb_each(review.suggestions->'metadata') as facts(k,v);
 return jsonb_build_object('reviewId',review.id,'version',review.version,'storeName',(select name from public.tenants where id=review.tenant_id),
  'metadata',metadata,'price',(review.suggestions->'price') - 'sourceIds','expiresAt',review.expires_at,'photos',to_jsonb(review.photo_sources),
  'terms',jsonb_build_object('versionId',terms.id,'title',terms.title,'body',terms.body,'language',terms.language),
  'response',case when response.id is null then null else jsonb_build_object('decision',response.decision,'createdAt',response.created_at) end);
end $$;
create function public.read_seller_review_photo(p_token text,p_photo uuid) returns text
language plpgsql security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review(p_token);
begin
 if p_photo is null or not(p_photo=any(review.photo_sources)) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 return review.tenant_id::text||'/'||review.session_id::text||'/'||p_photo::text||'.jpg';
end $$;
revoke all on function public.read_seller_review_photo(text,uuid) from public,anon;
grant execute on function public.read_seller_review_photo(text,uuid) to authenticated;
