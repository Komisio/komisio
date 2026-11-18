-- Reservation hashes are caller-supplied. Only a server-confirmed immutable
-- upload may match an analysis by content when its photo IDs have changed.
alter table public.external_item_photos add column content_verified_at timestamptz
 check(content_verified_at is null or isfinite(content_verified_at));

do $$ declare definition text; needle text := ' if tg_op=''DELETE'' then'; begin
 definition:=replace(pg_get_functiondef('komisio_private.guard_external_photo()'::regprocedure),E'\r','');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_EXTERNAL_PHOTO_GUARD'; end if;
 execute replace(definition,needle,$guard$
 if tg_op='UPDATE' and old.content_verified_at is null and new.content_verified_at is not null
  and old.discarded_at is null
  and (to_jsonb(new)-'content_verified_at')=(to_jsonb(old)-'content_verified_at') then
  perform komisio_private.require_seller_ai_server();
  if old.owner_id<>komisio_private.external_identity_owner() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects where bucket_id='external-item-photos' and name=old.path) then raise exception 'PHOTO_NOT_FOUND'; end if;
  return new;
 end if;
 if tg_op='DELETE' then$guard$);
end $$;

create function public.verify_external_item_photo(p_id uuid,p_sha256 text,p_bytes integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; photo public.external_item_photos;
begin
 perform komisio_private.require_seller_ai_server();
 uid:=komisio_private.external_identity_owner();
 perform komisio_private.lock_external_owner(uid);
 select * into photo from public.external_item_photos where id=p_id and owner_id=uid;
 if not found or photo.discarded_at is not null then raise exception 'PHOTO_NOT_FOUND'; end if;
 if p_sha256 is distinct from photo.sha256 or p_bytes is distinct from photo.bytes then raise exception 'REQUEST_CONFLICT'; end if;
 if not exists(select 1 from storage.objects where bucket_id='external-item-photos' and name=photo.path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 if photo.content_verified_at is null then
  update public.external_item_photos set content_verified_at=clock_timestamp() where id=p_id;
 end if;
 return p_id;
end $$;
revoke all on function public.verify_external_item_photo(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.verify_external_item_photo(uuid,text,integer) to authenticated;

create or replace function komisio_private.freeze_external_weight_analysis() returns trigger
language plpgsql security definer set search_path='' as $$
declare hashes jsonb;
begin
 select jsonb_agg(p.sha256 order by u.n) into hashes
 from unnest(new.photos) with ordinality u(id,n)
 join public.external_item_photos p on p.id=u.id and p.owner_id=new.owner_id
 where p.discarded_at is null and p.content_verified_at<=new.created_at;
 if coalesce(jsonb_array_length(hashes),0)<>cardinality(new.photos) then hashes:=null; end if;

 -- Exact-ID legacy submissions remain supported. Copied images additionally
 -- require server attestation, complete ordered evidence and the same identity.
 -- Read frozen AI evidence, so draft-photo cleanup cannot break the linkage.
 select a.id into new.weight_analysis_id
 from public.external_photo_ai_attempts a
 join public.external_photo_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id
 where a.owner_id=new.owner_id and a.tenant_id=new.tenant_id
  and a.prompt_version='central-photo-v2-weight'
  and r.output is not null and r.created_at<=new.created_at
  and (a.photos=new.photos or (
   hashes is not null and cardinality(a.photos)=cardinality(new.photos)
   and hashes=(select jsonb_agg(e.value->>'sha256' order by e.n)
    from jsonb_array_elements(a.evidence) with ordinality e(value,n))))
 order by r.created_at desc,a.id limit 1;
 return new;
end $$;
revoke all on function komisio_private.freeze_external_weight_analysis() from public,anon,authenticated;
