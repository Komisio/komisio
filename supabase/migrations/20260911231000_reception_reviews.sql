-- Staff-reviewed proposal snapshots, not seller consent or commercial acceptance.
create function komisio_private.valid_reception_refs(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare ref jsonb; seen text[]:='{}'; s text;
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value) not between 1 and 20 then return false; end if;
 for ref in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(ref)<>'string' then return false; end if;
  s:=ref#>>'{}';
  if s !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or s=any(seen) then return false; end if;
  seen:=array_append(seen,s);
 end loop;
 return true;
end $$;
create function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare metadata jsonb; price jsonb; fact jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['metadata','price','questions']) or (value-array['metadata','price','questions'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 metadata:=value->'metadata'; price:=value->'price';
 if jsonb_typeof(metadata)<>'object' or jsonb_typeof(price)<>'object' then return false; end if;
 if not(metadata ? 'description') or (metadata-array['description','category','color','brand','size','material','condition'])<>'{}'::jsonb then return false; end if;
 for fact in select v from jsonb_each(metadata) as fields(k,v) loop
  if jsonb_typeof(fact)<>'object' then return false; end if;
  if not(fact ?& array['value','sourceIds','certainty']) or (fact-array['value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(fact->'value')<>'string' or length(trim(fact->>'value')) not between 1 and 1000 or length(fact->>'value')>1000
   or fact->>'certainty' is distinct from 'observed' or not komisio_private.valid_reception_refs(fact->'sourceIds') then return false; end if;
 end loop;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if price->>'currency' is distinct from 'SEK' or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;
alter table public.reception_source_revisions add constraint reception_source_context_key unique(tenant_id,session_id,revision);
create table public.reception_reviews (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 session_id uuid not null,
 version integer not null check(version>0),
 source_revision integer not null,
 previous_review_id uuid references public.reception_reviews(id),
 agreement_id uuid not null,
 seller_email text not null check(length(seller_email)<=254),
 suggestions jsonb not null check(komisio_private.valid_reception_review(suggestions)),
 price_amount numeric(8,2) generated always as ((suggestions->'price'->>'amount')::numeric) stored check(price_amount>0),
 expires_at timestamptz not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(session_id,version),
 unique(tenant_id,id),
 foreign key(tenant_id,session_id,source_revision) references public.reception_source_revisions(tenant_id,session_id,revision),
 foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id)
);
create index reception_reviews_tenant on public.reception_reviews(tenant_id,session_id,version desc);
alter table public.reception_reviews enable row level security;
create policy reception_reviews_read on public.reception_reviews for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.reception_reviews from public,anon,authenticated;
grant select on public.reception_reviews to authenticated;
create trigger reception_reviews_immutable before update or delete on public.reception_reviews for each row execute function komisio_private.preserve_reception();
create view public.reception_reviews_current with(security_invoker=true) as
 select distinct on(session_id) * from public.reception_reviews order by session_id,version desc;
revoke all on public.reception_reviews_current from public,anon,authenticated;
grant select on public.reception_reviews_current to authenticated;

create function public.publish_reception_review(p_tenant uuid,p_request uuid,p_session uuid,p_source_revision integer,p_previous uuid,p_agreement uuid,p_suggestions jsonb,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_agreement is null or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_reviews where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid
   or prior.source_revision is distinct from p_source_revision or prior.previous_review_id is distinct from p_previous
   or prior.agreement_id is distinct from p_agreement or prior.suggestions is distinct from p_suggestions or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 select s.email into address from public.reception_sessions r join public.sellers s on s.id=r.seller_id and s.tenant_id=r.tenant_id where r.id=p_session and r.tenant_id=p_tenant;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into src from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if not found or src.revision<>p_source_revision then raise exception 'RECEPTION_CHANGED'; end if;
 select * into latest from public.reception_reviews where session_id=p_session order by version desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
 if coalesce(latest.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'RECEPTION_REVIEW_EXPIRED'; end if;
 for fact in select v from jsonb_each(p_suggestions->'metadata') as fields(k,v) loop
  for ref in select * from jsonb_array_elements_text(fact->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
 end loop;
 for ref in select * from jsonb_array_elements_text(p_suggestions->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,p_suggestions,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $$;
revoke all on function public.publish_reception_review(uuid,uuid,uuid,integer,uuid,uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.publish_reception_review(uuid,uuid,uuid,integer,uuid,uuid,jsonb,timestamptz) to authenticated;
revoke all on function komisio_private.valid_reception_refs(jsonb),komisio_private.valid_reception_review(jsonb) from public,anon,authenticated;
