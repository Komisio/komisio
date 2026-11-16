-- Owner-approved, manually handled account-wide deletion. A request is not erasure.
create function public.account_deletion_session_valid() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=auth.uid() and u.deleted_at is null
  and s.id=nullif(auth.jwt()->>'session_id','')::uuid
  and (s.not_after is null or s.not_after>now())
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true'
  and (not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified')
    or (auth.jwt()->>'aal'='aal2' and s.aal='aal2')))
 and not exists(select 1 from komisio_private.current_support_visit())
$$;
revoke all on function public.account_deletion_session_valid() from public,anon;
grant execute on function public.account_deletion_session_valid() to authenticated;

create function komisio_private.deletion_actor(p_host boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.account_deletion_session_valid() then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if exists(select 1 from komisio_private.current_support_visit()) then raise exception 'SUPPORT_READ_ONLY' using errcode='42501'; end if;
 if p_host and not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return auth.uid();
end $$;

create function komisio_private.deletion_sellers(p_user uuid) returns setof public.sellers
language sql stable security definer set search_path='' as $$
 select s.* from public.sellers s where s.external_owner_id=p_user or
 (s.external_owner_id is null and exists(select 1 from auth.users u where u.id=p_user
  and u.email_confirmed_at is not null and nullif(u.email,'') is not null and lower(trim(s.email))=lower(trim(u.email))))
$$;

create table public.account_deletion_requests (
 id uuid primary key,
 -- Deliberately not an Auth FK: deleting the login must not delete the case.
 user_id uuid not null unique,
 locale text not null check(locale in ('sv','en','no','da','fi','de','es','it')),
 seller_ids uuid[] not null,
 apple_linked boolean not null,
 created_at timestamptz not null,
 respond_by timestamptz not null,
 check(respond_by=created_at+interval '1 month')
);
create table public.account_deletion_events (
 id uuid primary key,
 request_id uuid not null references public.account_deletion_requests(id),
 kind text not null check(kind in ('processing','completed')),
 evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object'),
 created_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,kind)
);
create index account_deletion_queue on public.account_deletion_requests(created_at,id);
do $$ declare t text; begin
 foreach t in array array['account_deletion_requests','account_deletion_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function komisio_private.preserve_operation()',t);
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on public.%I for each statement execute function komisio_private.guard_support_write()',t);
 end loop;
end $$;
create policy account_deletion_self on public.account_deletion_requests for select to authenticated
 using(user_id=auth.uid() and public.account_deletion_session_valid());
-- Handling evidence is host-only; the self RPC returns a bounded status instead.
create policy account_deletion_host_events on public.account_deletion_events for select to authenticated
 using(public.is_platform_host() and public.account_deletion_session_valid());

create function komisio_private.deletion_status(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'status',coalesce(e.kind,'requested'),'createdAt',r.created_at,
  'respondBy',r.respond_by,'updatedAt',coalesce(e.created_at,r.created_at),'revision',e.id)
 from public.account_deletion_requests r left join lateral
  (select * from public.account_deletion_events where request_id=r.id order by (kind='completed') desc limit 1) e on true
 where r.id=p_id
$$;
create function public.my_account_deletion() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.deletion_actor(); result jsonb;
begin
 select komisio_private.deletion_status(id) into result from public.account_deletion_requests where user_id=uid;
 return result;
end $$;
create function public.request_account_deletion(p_id uuid,p_locale text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.deletion_actor(); prior public.account_deletion_requests; stamp timestamptz:=clock_timestamp();
begin
 if p_id is null or p_confirm is distinct from true or p_locale is null or p_locale not in ('sv','en','no','da','fi','de','es','it') then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||uid::text,0));
 if exists(select 1 from public.account_deletion_requests where id=p_id and user_id<>uid) then raise exception 'REQUEST_CONFLICT'; end if;
 select * into prior from public.account_deletion_requests where user_id=uid;
 if found then return komisio_private.deletion_status(prior.id); end if;
 insert into public.account_deletion_requests(id,user_id,locale,seller_ids,apple_linked,created_at,respond_by)
 values(p_id,uid,p_locale,array(select id from komisio_private.deletion_sellers(uid)),
  exists(select 1 from auth.identities where user_id=uid and provider='apple'),stamp,stamp+interval '1 month');
 return komisio_private.deletion_status(p_id);
end $$;

create function komisio_private.deletion_checks(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'authRemoved',not exists(select 1 from auth.users where id=r.user_id and deleted_at is null),
  'identitiesRemoved',not exists(select 1 from auth.identities where user_id=r.user_id),
  'sessionsRemoved',not exists(select 1 from auth.sessions where user_id=r.user_id),
  'membershipsRemoved',not exists(select 1 from public.tenant_members where user_id=r.user_id),
  'profileRemoved',not exists(select 1 from public.user_profiles where user_id=r.user_id),
  'pushRemoved',not exists(select 1 from komisio_private.seller_push_devices where user_id=r.user_id and (enabled or token is not null)),
  'sellerContactsClosed',not exists(select 1 from public.sellers s where s.privacy_closed_at is null
    and (s.id=any(r.seller_ids) or s.id in(select id from komisio_private.deletion_sellers(r.user_id)))))
 from public.account_deletion_requests r where r.id=p_id
$$;
create function public.host_account_deletions(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.deletion_actor(true);
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(value order by created_at,id),'[]') into result from (
  select r.id,r.created_at,komisio_private.deletion_status(r.id)||jsonb_build_object(
   'userId',r.user_id,'locale',r.locale,'email',coalesce(u.email,''),'phone',coalesce(u.phone,''),
   'appleLinked',r.apple_linked,'checks',komisio_private.deletion_checks(r.id),
   'externalRequests',(select count(*) from public.external_item_requests where owner_id=r.user_id),
   'externalPhotos',(select count(*) from public.external_item_photos where owner_id=r.user_id),
   'stores',coalesce((select jsonb_agg(jsonb_build_object('tenantId',s.tenant_id,'sellerId',s.id,'name',t.name,
     'closed',s.privacy_closed_at is not null,
     'balanceUnsettled',(b.value->>'availableOre')::numeric<>0 or (b.value->>'reservedOre')::numeric<>0,
     'openItems',(select count(*) from public.items i where i.tenant_id=s.tenant_id and i.seller_id=s.id
       and komisio_private.item_lifecycle(i.tenant_id,i.id)->>'stage' not in ('sold','ended'))))
    from public.sellers s join public.tenants t on t.id=s.tenant_id
    cross join lateral (select komisio_private.seller_balance_facts(s.tenant_id,s.id) as value) b
    where s.id=any(r.seller_ids) or s.id in(select id from komisio_private.deletion_sellers(r.user_id))),'[]')) as value
  from public.account_deletion_requests r left join auth.users u on u.id=r.user_id
  order by r.created_at,r.id limit 50 offset p_offset
 ) cases;
 return jsonb_build_object('rows',result,'total',(select count(*) from public.account_deletion_requests));
end $$;
create function public.handle_account_deletion(p_id uuid,p_request uuid,p_expected uuid,p_kind text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.deletion_actor(true); req public.account_deletion_requests; prior public.account_deletion_events; current jsonb;
begin
 if p_id is null or p_kind is null or p_kind not in ('processing','completed') or p_evidence is null or jsonb_typeof(p_evidence)<>'object' then raise exception 'INVALID_INPUT'; end if;
 select * into req from public.account_deletion_requests where id=p_request for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 select * into prior from public.account_deletion_events where id=p_id;
 if found then
  if prior.request_id<>p_request or prior.created_by<>uid or prior.kind<>p_kind or prior.evidence<>p_evidence then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.deletion_status(p_request);
 end if;
 current:=komisio_private.deletion_status(p_request);
 if (current->>'revision')::uuid is distinct from p_expected then raise exception 'REQUEST_CHANGED'; end if;
 if (p_kind='processing' and current->>'status'<>'requested') or (p_kind='completed' and current->>'status'<>'processing') then raise exception 'REQUEST_CHANGED'; end if;
 if p_kind='processing' and p_evidence<>'{}' then raise exception 'INVALID_INPUT'; end if;
 if p_kind='completed' then
  if exists(select 1 from jsonb_each(komisio_private.deletion_checks(p_request)) where value<>'true'::jsonb) then raise exception 'DELETION_INCOMPLETE'; end if;
  if p_evidence->'personalDataReviewed' is distinct from 'true'::jsonb
   or p_evidence->'externalCopiesReviewed' is distinct from 'true'::jsonb
   or p_evidence->'confirmationSent' is distinct from 'true'::jsonb
   or coalesce(p_evidence->>'appleHandling','') not in ('revoked','manual_instructions','not_applicable')
   or (req.apple_linked and p_evidence->>'appleHandling'='not_applicable')
   or coalesce(length(trim(p_evidence->>'retentionReason')),0) not between 10 and 2000
   or coalesce(length(trim(p_evidence->>'confirmationReference')),0) not between 3 and 200
   or p_evidence-array['personalDataReviewed','externalCopiesReviewed','confirmationSent','appleHandling','retentionReason','confirmationReference']<>'{}'::jsonb
  then raise exception 'INVALID_INPUT'; end if;
 end if;
 insert into public.account_deletion_events(id,request_id,kind,evidence,created_by) values(p_id,p_request,p_kind,p_evidence,uid);
 return komisio_private.deletion_status(p_request);
end $$;

revoke all on function komisio_private.deletion_actor(boolean),komisio_private.deletion_sellers(uuid),komisio_private.deletion_status(uuid),komisio_private.deletion_checks(uuid) from public,anon,authenticated;
revoke all on function public.my_account_deletion(),public.request_account_deletion(uuid,text,boolean),public.host_account_deletions(integer),public.handle_account_deletion(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.my_account_deletion(),public.request_account_deletion(uuid,text,boolean),public.host_account_deletions(integer),public.handle_account_deletion(uuid,uuid,uuid,text,jsonb) to authenticated;
