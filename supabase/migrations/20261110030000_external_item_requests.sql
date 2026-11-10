-- External pre-arrival evidence is owned by an Auth identity, not a tenant seller.
-- This boundary deliberately does not change verified_session or require_seller.
create function public.external_phone_verified() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and phone_confirmed_at is not null
  and nullif(phone,'') is not null and coalesce(raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true')
 and (not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
  or coalesce(auth.jwt()->>'aal','')='aal2');
$$;
create function komisio_private.external_phone_owner() returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not public.external_phone_verified() then raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function komisio_private.lock_external_owner(p_owner uuid) returns void
language sql set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended('external-item-owner:'||p_owner::text,0));
$$;

create table public.external_item_photos (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 path text not null unique,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer not null check(bytes between 1 and 1048576),
 created_at timestamptz not null default statement_timestamp(),
 discarded_at timestamptz,
 check(path=owner_id::text||'/'||id::text||'.jpg')
);
create table public.external_item_requests (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 tenant_id uuid not null references public.tenants(id),
 description text not null check(length(description) between 1 and 160),
 brand text not null check(length(brand)<=100),
 condition text not null check(condition in ('like_new','very_good','good','worn')),
 notes text not null check(length(notes)<=1000),
 desired_price_ore numeric(11,0) check(desired_price_ore between 1 and 99999999999),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 photos uuid[] not null check(cardinality(photos) between 1 and 8),
 created_at timestamptz not null default statement_timestamp(),
 unique(tenant_id,id)
);
create table public.external_item_request_declines (
 id uuid primary key,
 tenant_id uuid not null,
 request_id uuid not null unique,
 note text not null check(length(note)<=1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default statement_timestamp(),
 foreign key(tenant_id,request_id) references public.external_item_requests(tenant_id,id)
);
create index external_item_requests_owner on public.external_item_requests(owner_id,created_at desc,id);
create index external_item_requests_queue on public.external_item_requests(tenant_id,created_at desc,id);
create index external_item_requests_photos on public.external_item_requests using gin(photos);
create index external_item_photos_owner on public.external_item_photos(owner_id);

create trigger external_item_requests_immutable before update or delete on public.external_item_requests
 for each row execute function komisio_private.preserve_payout_event();
create trigger external_item_request_declines_immutable before update or delete on public.external_item_request_declines
 for each row execute function komisio_private.preserve_payout_event();
create function komisio_private.guard_external_photo() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.lock_external_owner(old.owner_id);
 if exists(select 1 from public.external_item_requests where photos @> array[old.id]) then raise exception 'PHOTO_IN_USE'; end if;
 if tg_op='DELETE' then
  if old.discarded_at is null or exists(select 1 from storage.objects where bucket_id='external-item-photos' and name=old.path) then raise exception 'PHOTO_STILL_STORED'; end if;
  return old;
 end if;
 if (to_jsonb(new)-'discarded_at') is distinct from (to_jsonb(old)-'discarded_at')
  or old.discarded_at is not null or new.discarded_at is null then raise exception 'IMMUTABLE' using errcode='55000'; end if;
 return new;
end $$;
create trigger external_item_photos_guard before update or delete on public.external_item_photos
 for each row execute function komisio_private.guard_external_photo();
do $$ declare t text; begin
 foreach t in array array['external_item_photos','external_item_requests','external_item_request_declines'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on public.%I for each statement execute function komisio_private.guard_support_write()',t);
 end loop;
end $$;
create trigger plan_gate before insert on public.external_item_requests
 for each row execute function komisio_private.plan_gate();
create trigger plan_gate before insert on public.external_item_request_declines
 for each row execute function komisio_private.plan_gate();

create policy external_item_request_read on public.external_item_requests for select to authenticated using(
 (owner_id=auth.uid() and public.external_phone_verified()) or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy external_item_decline_read on public.external_item_request_declines for select to authenticated using(
 exists(select 1 from public.external_item_requests r where r.id=request_id));
create policy external_item_photo_read on public.external_item_photos for select to authenticated using(
 (owner_id=auth.uid() and public.external_phone_verified()) or exists(
  select 1 from public.external_item_requests r where r.photos @> array[external_item_photos.id]
   and public.tenant_role(r.tenant_id) in ('owner','admin','staff','readonly')));

create function public.reserve_external_item_photo(p_id uuid,p_sha256 text,p_bytes integer) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); prior public.external_item_photos; result text;
begin
 if p_id is null or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 1 and 1048576 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into prior from public.external_item_photos where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.sha256<>p_sha256 or prior.bytes<>p_bytes or prior.discarded_at is not null then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.path;
 end if;
 if (select count(*) from public.external_item_photos p where p.owner_id=uid
  and not exists(select 1 from public.external_item_requests r where r.photos @> array[p.id]))>=80 then raise exception 'PHOTO_LIMIT'; end if;
 result:=uid::text||'/'||p_id::text||'.jpg';
 insert into public.external_item_photos(id,owner_id,path,sha256,bytes) values(p_id,uid,result,p_sha256,p_bytes);
 return result;
end $$;

-- Storage calls use the same owner lock as submit/discard, so a policy check
-- cannot authorize a late upload or delete using a stale reservation snapshot.
create function public.external_item_photo_access(p_name text,p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare photo public.external_item_photos;
begin
 if p_action is null or p_action not in ('read','insert','delete') then return false; end if;
 select * into photo from public.external_item_photos where path=p_name;
 if not found then return false; end if;
 if p_action='read' then
  return (photo.owner_id=auth.uid() and public.external_phone_verified()) or exists(
   select 1 from public.external_item_requests r where r.photos @> array[photo.id]
    and public.tenant_role(r.tenant_id) in ('owner','admin','staff','readonly'));
 end if;
 if photo.owner_id<>komisio_private.external_phone_owner() then return false; end if;
 perform komisio_private.lock_external_owner(photo.owner_id);
 select * into photo from public.external_item_photos where path=p_name;
 if not found then return false; end if;
 if p_action='insert' then return photo.discarded_at is null; end if;
 return photo.discarded_at is not null and not exists(select 1 from public.external_item_requests where photos @> array[photo.id]);
exception when others then return false;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('external-item-photos','external-item-photos',false,1048576,array['image/jpeg']);
create policy external_item_photo_insert on storage.objects for insert to authenticated
 with check(bucket_id='external-item-photos' and public.external_item_photo_access(name,'insert'));
create policy external_item_photo_download on storage.objects for select to authenticated
 using(bucket_id='external-item-photos' and public.external_item_photo_access(name,'read'));
create policy external_item_photo_delete on storage.objects for delete to authenticated
 using(bucket_id='external-item-photos' and public.external_item_photo_access(name,'delete'));

create function public.discard_external_item_photo(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); photo public.external_item_photos;
begin
 perform komisio_private.lock_external_owner(uid);
 select * into photo from public.external_item_photos where id=p_id and owner_id=uid;
 if not found then return null; end if;
 if exists(select 1 from public.external_item_requests where photos @> array[p_id]) then raise exception 'PHOTO_IN_USE'; end if;
 if photo.discarded_at is null then update public.external_item_photos set discarded_at=statement_timestamp() where id=p_id; end if;
 return photo.path;
end $$;
create function public.finish_external_item_photo_discard(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner();
begin
 perform komisio_private.lock_external_owner(uid);
 delete from public.external_item_photos where id=p_id and owner_id=uid;
end $$;

create function public.submit_external_item_request(
 p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,
 p_price_ore numeric,p_currency text,p_photos uuid[]
) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); prior public.external_item_requests; policy jsonb;
 d text:=btrim(p_description); b text:=btrim(p_brand); n text:=btrim(p_notes);
begin
 if p_id is null or p_tenant is null or d is null or length(d) not between 1 and 160
  or b is null or length(b)>100 or n is null or length(n)>1000
  or p_condition is null or p_condition not in ('like_new','very_good','good','worn')
  or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  or (p_price_ore is not null and (p_price_ore<1 or p_price_ore>99999999999 or p_price_ore<>trunc(p_price_ore)))
  or p_photos is null or cardinality(p_photos) not between 1 and 8
  or array_ndims(p_photos)<>1 or array_lower(p_photos,1)<>1
  or (select count(distinct x) from unnest(p_photos) x)<>cardinality(p_photos)
 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into prior from public.external_item_requests where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.tenant_id<>p_tenant or prior.description<>d or prior.brand<>b
   or prior.condition<>p_condition or prior.notes<>n or prior.desired_price_ore is distinct from p_price_ore
   or prior.currency<>p_currency or prior.photos<>p_photos then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 -- Shares the policy writer's tenant lock; a concurrent opt-out wins in order.
 perform 1 from public.tenants where id=p_tenant for update;
 select v.policy into policy from public.store_policy_versions v where tenant_id=p_tenant order by version desc limit 1;
 if policy->'externalAppSubmissionsEnabled' is distinct from 'true'::jsonb then raise exception 'STORE_UNAVAILABLE'; end if;
 if coalesce(policy->>'currency','SEK')<>p_currency then raise exception 'STORE_CHANGED'; end if;
 if (select count(*) from public.external_item_requests r where owner_id=uid
  and not exists(select 1 from public.external_item_request_declines d where d.request_id=r.id))>=10 then raise exception 'ACTIVE_REQUEST_LIMIT'; end if;
 if (select count(*) from public.external_item_photos p where p.id=any(p_photos) and p.owner_id=uid and p.discarded_at is null
  and exists(select 1 from storage.objects o where o.bucket_id='external-item-photos' and o.name=p.path))<>cardinality(p_photos)
 then raise exception 'PHOTO_NOT_FOUND'; end if;
 insert into public.external_item_requests(id,owner_id,tenant_id,description,brand,condition,notes,desired_price_ore,currency,photos)
 values(p_id,uid,p_tenant,d,b,p_condition,n,p_price_ore,p_currency,p_photos);
 return p_id;
end $$;

create function public.decline_external_item_request(p_id uuid,p_tenant uuid,p_request uuid,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); own uuid; prior public.external_item_request_declines; n text:=btrim(coalesce(p_note,''));
begin
 if p_id is null or p_tenant is null or p_request is null or length(n)>1000 then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select owner_id into own from public.external_item_requests where id=p_request and tenant_id=p_tenant;
 if own is null then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform komisio_private.lock_external_owner(own);
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.external_item_request_declines where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.request_id<>p_request or prior.note<>n or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.external_item_request_declines where request_id=p_request) then raise exception 'REQUEST_CHANGED'; end if;
 insert into public.external_item_request_declines(id,tenant_id,request_id,note,created_by) values(p_id,p_tenant,p_request,n,uid);
 return p_id;
end $$;

create function public.my_external_item_requests(p_offset integer default 0,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); rows jsonb; active integer;
begin
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into active from public.external_item_requests r where r.owner_id=uid
  and not exists(select 1 from public.external_item_request_declines d where d.request_id=r.id);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into rows from (
  select r.id,r.tenant_id,t.name as store_name,r.description,r.brand,r.condition,r.notes,
   r.desired_price_ore::text,r.currency,r.photos,r.created_at,
   case when d.id is null then 'waiting' else 'declined' end as status,d.note as decline_note
  from public.external_item_requests r join public.tenants t on t.id=r.tenant_id
  left join public.external_item_request_declines d on d.request_id=r.id
  where r.owner_id=uid and (p_id is null or r.id=p_id)
  order by r.created_at desc,r.id limit 26 offset p_offset
 ) x;
 return jsonb_build_object('activeCount',active,'hasMore',jsonb_array_length(rows)>25,
  'requests',(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(rows) with ordinality e(value,ord) where ord<=25));
end $$;

revoke all on function komisio_private.external_phone_owner(),komisio_private.lock_external_owner(uuid),komisio_private.guard_external_photo() from public,anon,authenticated;
revoke all on function public.external_phone_verified(),public.reserve_external_item_photo(uuid,text,integer),public.external_item_photo_access(text,text),
 public.discard_external_item_photo(uuid),public.finish_external_item_photo_discard(uuid),
 public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[]),
 public.decline_external_item_request(uuid,uuid,uuid,text),public.my_external_item_requests(integer,uuid) from public,anon,authenticated;
grant execute on function public.external_phone_verified(),public.reserve_external_item_photo(uuid,text,integer),public.external_item_photo_access(text,text),
 public.discard_external_item_photo(uuid),public.finish_external_item_photo_discard(uuid),
 public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[]),
 public.decline_external_item_request(uuid,uuid,uuid,text),public.my_external_item_requests(integer,uuid) to authenticated;
