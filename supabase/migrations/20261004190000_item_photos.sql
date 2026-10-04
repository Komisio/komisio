-- Item media is independent of frozen acceptance evidence and seller publication.
create table public.item_photo_revisions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 item_id uuid not null,
 revision integer not null check(revision>0),
 action text not null check(action in ('add','default','remove')),
 photo_id uuid not null,
 photos jsonb not null check(jsonb_typeof(photos)='array' and jsonb_array_length(photos)<=20),
 default_photo_id uuid,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(item_id,revision),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
alter table public.item_photo_revisions enable row level security;
revoke all on public.item_photo_revisions from public,anon,authenticated;
grant select on public.item_photo_revisions to authenticated;
create policy item_photo_revisions_read on public.item_photo_revisions for select to authenticated using(public.tenant_role(tenant_id) is not null);
create trigger item_photo_revisions_immutable before update or delete on public.item_photo_revisions for each row execute function komisio_private.preserve_correction();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('item-photos','item-photos',false,1048576,array['image/jpeg']);
create function public.item_photo_access(p_path text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tid uuid; iid uuid; r text;
begin
 if p_path is null or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
 begin tid:=split_part(p_path,'/',1)::uuid; iid:=split_part(p_path,'/',2)::uuid;
 exception when invalid_text_representation then return false; end;
 r:=public.tenant_role(tid);
 if r is null or (p_write and r not in ('owner','admin','staff')) then return false; end if;
 return exists(select 1 from public.items where tenant_id=tid and id=iid);
end $$;
revoke all on function public.item_photo_access(text,boolean) from public;
grant execute on function public.item_photo_access(text,boolean) to anon,authenticated;
create policy item_photo_read on storage.objects for select to authenticated using(bucket_id='item-photos' and public.item_photo_access(name,false));
create policy item_photo_insert on storage.objects for insert to authenticated with check(bucket_id='item-photos' and public.item_photo_access(name,true));
create policy item_photo_read_boundary on storage.objects as restrictive for select to public using(bucket_id<>'item-photos' or public.item_photo_access(name,false));
create policy item_photo_insert_boundary on storage.objects as restrictive for insert to public with check(bucket_id<>'item-photos' or public.item_photo_access(name,true));
create policy item_photo_no_update on storage.objects as restrictive for update to public using(bucket_id<>'item-photos') with check(bucket_id<>'item-photos');
create policy item_photo_no_delete on storage.objects as restrictive for delete to public using(bucket_id<>'item-photos');

-- Called only after tenant authorization. Inherit the exact accepted source revision,
-- not a later reception draft or a different item's photo.
create function komisio_private.item_photo_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.item_photo_revisions; photos jsonb;
begin
 select * into r from public.item_photo_revisions where tenant_id=p_tenant and item_id=p_item order by revision desc limit 1;
 if found then return jsonb_build_object('itemId',p_item,'revision',r.revision,'photos',r.photos,'defaultPhotoId',r.default_photo_id); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s->>'id','bucket','reception-photos','path',s->>'reference') order by ord),'[]'::jsonb) into photos
 from public.items i join public.reception_reviews rr on i.origin_kind='reception_review' and rr.tenant_id=i.tenant_id and rr.session_id=i.origin_id and rr.version=i.origin_revision
 join public.reception_source_revisions sr on sr.tenant_id=rr.tenant_id and sr.session_id=rr.session_id and sr.revision=rr.source_revision
 cross join lateral jsonb_array_elements(sr.sources) with ordinality as source(s,ord)
 where i.tenant_id=p_tenant and i.id=p_item and s->>'kind'='photo';
 return jsonb_build_object('itemId',p_item,'revision',0,'photos',photos,'defaultPhotoId',photos->0->>'id');
end $$;
revoke all on function komisio_private.item_photo_snapshot(uuid,uuid) from public,anon,authenticated;

create function public.item_photo_state(p_tenant uuid,p_items uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.tenant_role(p_tenant) is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_items is null or cardinality(p_items)>20 then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(komisio_private.item_photo_snapshot(p_tenant,i.id) order by i.id) from public.items i where i.tenant_id=p_tenant and i.id=any(p_items)),'[]'::jsonb);
end $$;
revoke all on function public.item_photo_state(uuid,uuid[]) from public,anon;
grant execute on function public.item_photo_state(uuid,uuid[]) to authenticated;

create function public.change_item_photo(p_tenant uuid,p_request uuid,p_item uuid,p_expected integer,p_action text,p_photo uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_photo_revisions; snapshot jsonb; photos jsonb; chosen uuid; path text; rev integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_item is null or p_photo is null or p_expected is null or p_expected<0 or p_expected>=2147483647 or p_action is null or p_action not in ('add','default','remove') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_photo_revisions where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.item_id<>p_item or prior.created_by<>uid or prior.revision<>p_expected+1 or prior.action<>p_action or prior.photo_id<>p_photo then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.revision;
 end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND'; end if;
 snapshot:=komisio_private.item_photo_snapshot(p_tenant,p_item);
 rev:=(snapshot->>'revision')::integer;
 if rev<>p_expected then raise exception 'ITEM_PHOTOS_CHANGED'; end if;
 photos:=snapshot->'photos'; chosen:=(snapshot->>'defaultPhotoId')::uuid;
 if p_action='add' then
  if jsonb_array_length(photos)>=20 then raise exception 'PHOTO_LIMIT'; end if;
  if exists(select 1 from jsonb_array_elements(photos) x where x->>'id'=p_photo::text) then raise exception 'INVALID_INPUT'; end if;
  path:=p_tenant::text||'/'||p_item::text||'/'||p_photo::text||'.jpg';
  if not exists(select 1 from storage.objects where bucket_id='item-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('id',p_photo,'bucket','item-photos','path',path));
  chosen:=coalesce(chosen,p_photo);
 else
  if not exists(select 1 from jsonb_array_elements(photos) x where x->>'id'=p_photo::text) then raise exception 'PHOTO_NOT_FOUND'; end if;
  if p_action='default' then chosen:=p_photo;
  else
   select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into photos from jsonb_array_elements(photos) with ordinality as elements(x,ord) where x->>'id'<>p_photo::text;
   if chosen=p_photo then chosen:=(photos->0->>'id')::uuid; end if;
  end if;
 end if;
 insert into public.item_photo_revisions(id,tenant_id,item_id,revision,action,photo_id,photos,default_photo_id,created_by)
 values(p_request,p_tenant,p_item,rev+1,p_action,p_photo,photos,chosen,uid);
 perform komisio_private.record_access(p_tenant,'item.photos_changed',p_item,jsonb_build_object('revision',rev+1,'action',p_action,'photoId',p_photo));
 return rev+1;
end $$;
revoke all on function public.change_item_photo(uuid,uuid,uuid,integer,text,uuid) from public,anon;
grant execute on function public.change_item_photo(uuid,uuid,uuid,integer,text,uuid) to authenticated;
