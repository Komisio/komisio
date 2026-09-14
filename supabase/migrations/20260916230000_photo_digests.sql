-- Photo duplicates, step one of docs/DUPLICATE-CHECK.md: every reception
-- photo gets a content digest (SHA-256 of the stored bytes) recorded by the
-- upload route. The same digest in another session of the store is a
-- certain repeat of that photo; the reception page shows where it was
-- seen before. Nothing is refused, deleted or merged; the person decides.
create table public.reception_photo_digests (
 tenant_id uuid not null references public.tenants(id),
 session_id uuid not null,
 photo_id uuid not null,
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(tenant_id,session_id,photo_id),
 foreign key(tenant_id,session_id) references public.reception_sessions(tenant_id,id)
);
create index reception_photo_digests_lookup on public.reception_photo_digests(tenant_id,digest,created_at,session_id);
alter table public.reception_photo_digests enable row level security;
create policy reception_photo_digests_read on public.reception_photo_digests for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.reception_photo_digests from public,anon,authenticated;
grant select on public.reception_photo_digests to authenticated;
create function komisio_private.preserve_photo_digest() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_PHOTO_DIGEST' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_photo_digest() from public,anon,authenticated;
create trigger reception_photo_digests_immutable before update or delete on public.reception_photo_digests
 for each row execute function komisio_private.preserve_photo_digest();

-- Recorded once per photo by the upload route after the bytes are stored.
-- A repeat with the same digest is the same request; another digest for
-- the same photo id is a conflict, since stored photos never change.
create function public.record_photo_digest(p_tenant uuid,p_session uuid,p_photo uuid,p_digest text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_session is null or p_photo is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.reception_sessions where tenant_id=p_tenant and id=p_session) then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select digest into existing from public.reception_photo_digests where tenant_id=p_tenant and session_id=p_session and photo_id=p_photo;
 if existing is not null then
  if existing<>p_digest then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 insert into public.reception_photo_digests(tenant_id,session_id,photo_id,digest,created_by) values(p_tenant,p_session,p_photo,p_digest,uid);
end $$;
revoke all on function public.record_photo_digest(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.record_photo_digest(uuid,uuid,uuid,text) to authenticated;

-- For one session: each photo that was seen before in another session of
-- the store, with up to five earlier sightings, oldest first. Any member.
create function public.photo_duplicates(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_session is null then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('photoId',d.photo_id,'seen',d.seen) order by d.created_at,d.photo_id),'[]'::jsonb) into rows
 from (
  select d.photo_id,d.created_at,
   (select jsonb_agg(jsonb_build_object('sessionId',o.session_id,'photoId',o.photo_id,'seenAt',o.created_at,'sellerId',s.seller_id,'sellerName',se.name) order by o.created_at,o.session_id,o.photo_id)
    from (select * from public.reception_photo_digests o where o.tenant_id=p_tenant and o.digest=d.digest and o.session_id<>p_session order by o.created_at,o.session_id,o.photo_id limit 5) o
    join public.reception_sessions s on s.tenant_id=o.tenant_id and s.id=o.session_id
    join public.sellers se on se.tenant_id=s.tenant_id and se.id=s.seller_id) as seen
  from public.reception_photo_digests d where d.tenant_id=p_tenant and d.session_id=p_session) d
 where d.seen is not null;
 return jsonb_build_object('photos',rows);
end $$;
revoke all on function public.photo_duplicates(uuid,uuid) from public,anon;
grant execute on function public.photo_duplicates(uuid,uuid) to authenticated;
