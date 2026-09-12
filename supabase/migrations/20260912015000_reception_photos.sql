insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('reception-photos','reception-photos',false,3145728,array['image/jpeg','image/png']) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='reception-photos' and not public and file_size_limit=3145728 and allowed_mime_types=array['image/jpeg','image/png']) then raise exception 'RECEPTION_BUCKET_CONFIG_CONFLICT'; end if;
end $$;
create function public.reception_photo_access(p_path text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tid uuid; sid uuid; r text;
begin
 if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$' then return false; end if;
 tid:=split_part(p_path,'/',1)::uuid; sid:=split_part(p_path,'/',2)::uuid;
 r:=public.tenant_role(tid);
 if r is null or (p_write and r not in ('owner','admin','staff')) then return false; end if;
 return exists(select 1 from public.reception_sessions where id=sid and tenant_id=tid);
end $$;
revoke all on function public.reception_photo_access(text,boolean) from public;
grant execute on function public.reception_photo_access(text,boolean) to authenticated,anon;
create policy reception_photo_read on storage.objects for select to authenticated using(bucket_id='reception-photos' and public.reception_photo_access(name,false));
create policy reception_photo_insert on storage.objects for insert to authenticated with check(bucket_id='reception-photos' and public.reception_photo_access(name,true));
-- Restrictive policies prevent an unrelated broad policy from exposing this bucket.
create policy reception_photo_read_boundary on storage.objects as restrictive for select to public using(bucket_id<>'reception-photos' or public.reception_photo_access(name,false));
create policy reception_photo_insert_boundary on storage.objects as restrictive for insert to public with check(bucket_id<>'reception-photos' or public.reception_photo_access(name,true));
create policy reception_photo_no_update on storage.objects as restrictive for update to public using(bucket_id<>'reception-photos') with check(bucket_id<>'reception-photos');
create policy reception_photo_no_delete on storage.objects as restrictive for delete to public using(bucket_id<>'reception-photos');

create or replace function komisio_private.valid_reception_sources(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare source jsonb; seen uuid[]:='{}'; sid uuid;
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value) not between 1 and 20 then return false; end if;
 for source in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(source)<>'object' then return false; end if;
  if not(source ?& array['id','kind','reference','observation']) or (source-array['id','kind','reference','observation'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(source->'id')<>'string' or jsonb_typeof(source->'kind')<>'string'
   or jsonb_typeof(source->'reference')<>'string' or jsonb_typeof(source->'observation')<>'string' then return false; end if;
  if (source->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  sid:=(source->>'id')::uuid;
  if sid=any(seen) then return false; end if;
  seen:=array_append(seen,sid);
  if source->>'kind' not in ('observation','price-evidence','photo')
   or length(trim(source->>'reference')) not between 1 and 500
   or length(source->>'reference')>500 or length(source->>'observation')>2000 then return false; end if;
 end loop;
 return true;
end $$;

create or replace function public.save_reception_sources(p_tenant uuid,p_request uuid,p_session uuid,p_expected integer,p_sources jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.reception_source_revisions; latest integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_expected is null or p_expected<0 or p_expected>=2147483647
  or not komisio_private.valid_reception_sources(p_sources) then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.reception_source_revisions where id=p_request;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.session_id is distinct from p_session or previous.created_by is distinct from uid
   or previous.revision is distinct from p_expected+1 or previous.sources is distinct from p_sources then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if not exists(select 1 from public.reception_sessions where id=p_session and tenant_id=p_tenant) then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select revision into latest from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if coalesce(latest,0)<>p_expected then raise exception 'RECEPTION_CHANGED'; end if;
 if exists(select 1 from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) old_source
  cross join jsonb_array_elements(p_sources) new_source
  where r.session_id=p_session and old_source->>'id'=new_source->>'id' and old_source<>new_source) then raise exception 'RECEPTION_SOURCE_CHANGED'; end if;
 if exists(select 1 from jsonb_array_elements(p_sources) s where s->>'kind'='photo' and (
  s->>'reference' not in (p_tenant::text||'/'||p_session::text||'/'||(s->>'id')||'.png',p_tenant::text||'/'||p_session::text||'/'||(s->>'id')||'.jpg')
  or not exists(select 1 from storage.objects o where o.bucket_id='reception-photos' and o.name=s->>'reference')
 )) then raise exception 'INVALID_INPUT'; end if;
 insert into public.reception_source_revisions(id,tenant_id,session_id,revision,sources,created_by)
 values(p_request,p_tenant,p_session,p_expected+1,p_sources,uid);
 perform komisio_private.record_access(p_tenant,'reception.sources_saved',p_session,jsonb_build_object('revision',p_expected+1));
 return p_request;
end $$;
