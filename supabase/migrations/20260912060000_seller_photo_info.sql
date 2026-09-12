-- Hosted Storage checks authenticated object info before serving a private
-- download. Keep the same recipient/capability boundary on both operations.
create or replace function public.seller_reception_photo_access(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare token text; review public.reception_reviews;
begin
 if not storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info']) then return false; end if;
 token:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-komisio-review-token';
 if token is null or token !~ '^[a-f0-9]{64}$' then return false; end if;
 review:=komisio_private.seller_review(token);
 return exists(select 1 from unnest(review.photo_sources) photo where p_path=review.tenant_id::text||'/'||review.session_id::text||'/'||photo::text||'.jpg');
exception when others then return false;
end $$;
