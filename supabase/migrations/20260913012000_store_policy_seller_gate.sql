-- Agreement-free staff publication is not a seller contract invitation.
create or replace function public.set_reception_access(p_tenant uuid,p_request uuid,p_review uuid,p_previous uuid,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_access_events; latest public.reception_access_events; review public.reception_reviews;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_review is null or (p_hash is not null and p_hash !~ '^[a-f0-9]{64}$') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_access_events where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.review_id is distinct from p_review or prior.created_by is distinct from uid or prior.previous_id is distinct from p_previous or prior.token_hash is distinct from p_hash then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 select * into review from public.reception_reviews where id=p_review and tenant_id=p_tenant;
 if not found then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into latest from public.reception_access_events where review_id=p_review order by version desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'RECEPTION_ACCESS_CHANGED'; end if;
 if coalesce(latest.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 -- Revocation remains possible after expiry or supersession.
 if p_hash is not null then
  if review.agreement_id is null or review.expires_at<=now() or review.seller_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or exists(select 1 from public.reception_reviews where session_id=review.session_id and version>review.version)
   or exists(select 1 from public.reception_source_revisions where session_id=review.session_id and revision>review.source_revision) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 end if;
 insert into public.reception_access_events(id,tenant_id,review_id,version,previous_id,token_hash,created_by)
 values(p_request,p_tenant,p_review,coalesce(latest.version,0)+1,p_previous,p_hash,uid);
 perform komisio_private.record_access(p_tenant,case when p_hash is null then 'reception.access_revoked' else 'reception.access_issued' end,p_review,'{}');
 return p_request;
end $$;

