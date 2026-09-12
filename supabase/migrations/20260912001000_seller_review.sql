-- Seller capabilities do not grant tenant membership or direct table access.
create table public.reception_access_events (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 review_id uuid not null,
 version integer not null check(version>0),
 previous_id uuid references public.reception_access_events(id),
 token_hash text unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(review_id,version),
 foreign key(tenant_id,review_id) references public.reception_reviews(tenant_id,id)
);
create table public.reception_responses (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 review_id uuid not null unique,
 access_id uuid not null references public.reception_access_events(id),
 decision text not null check(decision in ('approve','decline')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,review_id) references public.reception_reviews(tenant_id,id)
);
alter table public.reception_access_events enable row level security;
alter table public.reception_responses enable row level security;
create policy reception_access_read on public.reception_access_events for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy reception_response_read on public.reception_responses for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.reception_access_events,public.reception_responses from public,anon,authenticated;
grant select on public.reception_access_events,public.reception_responses to authenticated;
create trigger reception_access_immutable before update or delete on public.reception_access_events for each row execute function komisio_private.preserve_reception();
create trigger reception_response_immutable before update or delete on public.reception_responses for each row execute function komisio_private.preserve_reception();

create function public.set_reception_access(p_tenant uuid,p_request uuid,p_review uuid,p_previous uuid,p_hash text) returns uuid
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
  if review.expires_at<=now() or review.seller_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or exists(select 1 from public.reception_reviews where session_id=review.session_id and version>review.version)
   or exists(select 1 from public.reception_source_revisions where session_id=review.session_id and revision>review.source_revision) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 end if;
 insert into public.reception_access_events(id,tenant_id,review_id,version,previous_id,token_hash,created_by)
 values(p_request,p_tenant,p_review,coalesce(latest.version,0)+1,p_previous,p_hash,uid);
 perform komisio_private.record_access(p_tenant,case when p_hash is null then 'reception.access_revoked' else 'reception.access_issued' end,p_review,'{}');
 return p_request;
end $$;

create function komisio_private.seller_review(p_token text) returns public.reception_reviews
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); access public.reception_access_events; review public.reception_reviews; address text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into access from public.reception_access_events where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then raise exception 'REVIEW_UNAVAILABLE'; end if;
 -- Same lock as staff changes, so no decision can race a replacement/revocation.
 perform 1 from public.tenants where id=access.tenant_id for update;
 if exists(select 1 from public.reception_access_events where review_id=access.review_id and version>access.version) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into review from public.reception_reviews where id=access.review_id;
 select lower(trim(email)) into address from auth.users where id=uid;
 if address is distinct from lower(trim(review.seller_email)) or review.expires_at<=now()
  or exists(select 1 from public.reception_reviews where session_id=review.session_id and version>review.version)
  or exists(select 1 from public.reception_source_revisions where session_id=review.session_id and revision>review.source_revision) then raise exception 'REVIEW_UNAVAILABLE'; end if;
 return review;
end $$;

create function public.read_seller_review(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review(p_token); terms public.seller_agreement_versions; response public.reception_responses; metadata jsonb;
begin
 select * into terms from public.seller_agreement_versions where id=review.agreement_id;
 select * into response from public.reception_responses where review_id=review.id;
 select jsonb_object_agg(k,v->>'value') into metadata from jsonb_each(review.suggestions->'metadata') as facts(k,v);
 return jsonb_build_object('reviewId',review.id,'version',review.version,'storeName',(select name from public.tenants where id=review.tenant_id),
  'metadata',metadata,'price',review.suggestions->'price' - 'sourceIds','expiresAt',review.expires_at,
  'terms',jsonb_build_object('versionId',terms.id,'title',terms.title,'body',terms.body,'language',terms.language),
  'response',case when response.id is null then null else jsonb_build_object('decision',response.decision,'createdAt',response.created_at) end);
end $$;

create function public.respond_to_reception_review(p_token text,p_request uuid,p_review uuid,p_decision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare review public.reception_reviews:=komisio_private.seller_review(p_token); prior public.reception_responses; uid uuid:=auth.uid(); access_id uuid;
begin
 if p_request is null or p_decision is null or p_decision not in ('approve','decline') then raise exception 'INVALID_INPUT'; end if;
 if review.id is distinct from p_review then raise exception 'REVIEW_UNAVAILABLE'; end if;
 select * into prior from public.reception_responses where id=p_request;
 if found then
  if prior.review_id is distinct from p_review or prior.created_by is distinct from uid or prior.decision is distinct from p_decision then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if exists(select 1 from public.reception_responses where review_id=p_review) then raise exception 'REVIEW_ALREADY_ANSWERED'; end if;
 select id into access_id from public.reception_access_events where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 insert into public.reception_responses(id,tenant_id,review_id,access_id,decision,created_by) values(p_request,review.tenant_id,p_review,access_id,p_decision,uid);
 perform komisio_private.record_access(review.tenant_id,'reception.seller_responded',p_review,jsonb_build_object('decision',p_decision));
 return p_request;
end $$;
revoke all on function komisio_private.seller_review(text) from public,anon,authenticated;
revoke all on function public.set_reception_access(uuid,uuid,uuid,uuid,text),public.read_seller_review(text),public.respond_to_reception_review(text,uuid,uuid,text) from public,anon;
grant execute on function public.set_reception_access(uuid,uuid,uuid,uuid,text),public.read_seller_review(text),public.respond_to_reception_review(text,uuid,uuid,text) to authenticated;
