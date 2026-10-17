-- Issue #490: delete a seller-agreement version only when nothing refers to it.
-- The live version is the highest remaining row, so a hidden flag would stay
-- current. Removal is limited to versions with no acceptance, drop-off, review,
-- item or sale reference. Translations exist only for that version and go with
-- it. Publication events keep the version high-water mark, so numbers are not reused.
create function komisio_private.seller_agreement_usage(p_tenant uuid,p_agreement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sellers bigint; receipts bigint; reviews bigint; items bigint; sales bigint; refs jsonb;
begin
 select count(distinct seller_id) into sellers from public.seller_agreement_evidence
  where tenant_id=p_tenant and agreement_id=p_agreement;
 select count(*) into receipts from public.bag_receipts
  where tenant_id=p_tenant and agreement_version_id=p_agreement;
 select count(*) into reviews from public.reception_reviews
  where tenant_id=p_tenant and agreement_id=p_agreement;
 select count(*) into items from public.items
  where tenant_id=p_tenant and terms->>'agreementVersionId'=p_agreement::text;
 select count(*) into sales from public.sale_lines
  where tenant_id=p_tenant and agreement_version_id=p_agreement;
 refs:=jsonb_build_object('sellers',sellers,'receipts',receipts,'reviews',reviews,'items',items,'sales',sales);
 return (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(refs) e(k,v) where v<>'0'::jsonb);
end $$;
revoke all on function komisio_private.seller_agreement_usage(uuid,uuid) from public,anon,authenticated;

create function komisio_private.guard_unused_agreement_delete() returns trigger
language plpgsql security definer set search_path='' as $$
declare usage jsonb; translations bigint;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=old.tenant_id for update;
 if coalesce(public.tenant_role(old.tenant_id),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 usage:=komisio_private.seller_agreement_usage(old.tenant_id,old.id);
 if usage<>'{}'::jsonb then raise exception 'AGREEMENT_IN_USE' using errcode='55000', detail=usage::text; end if;
 select count(*) into translations from public.seller_agreement_translations
  where tenant_id=old.tenant_id and agreement_id=old.id;
 perform komisio_private.record_access(old.tenant_id,'agreement.withdrawn',old.id,jsonb_build_object(
  'version',old.version,'title',old.title,'language',old.language,
  'requiredBeforeReceipt',old.required_before_receipt,'translations',translations));
 return old;
end $$;
revoke all on function komisio_private.guard_unused_agreement_delete() from public,anon,authenticated;

-- A translation row has no life apart from its version. Direct deletes stay rejected.
create function komisio_private.guard_agreement_translation_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.seller_agreement_versions v where v.tenant_id=old.tenant_id and v.id=old.agreement_id) then
  return old;
 end if;
 raise exception 'IMMUTABLE_AGREEMENT_RECORD' using errcode='55000';
end $$;
revoke all on function komisio_private.guard_agreement_translation_delete() from public,anon,authenticated;

do $$
declare cname text;
begin
 select con.conname into cname
 from pg_constraint con
 join pg_class rel on rel.oid=con.conrelid
 join pg_namespace nsp on nsp.oid=rel.relnamespace
 where nsp.nspname='public' and rel.relname='seller_agreement_translations' and con.contype='f'
  and exists(select 1 from pg_class ref where ref.oid=con.confrelid and ref.relname='seller_agreement_versions');
 if cname is null then raise exception 'AGREEMENT_TRANSLATION_FK_MISSING'; end if;
 execute format('alter table public.seller_agreement_translations drop constraint %I',cname);
end $$;
alter table public.seller_agreement_translations
 add constraint seller_agreement_translations_version_fkey
 foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id) on delete cascade;

drop trigger immutable_agreement on public.seller_agreement_versions;
create trigger immutable_agreement before update on public.seller_agreement_versions
 for each row execute function komisio_private.preserve_agreement_record();
create trigger guard_agreement_delete before delete on public.seller_agreement_versions
 for each row execute function komisio_private.guard_unused_agreement_delete();

drop trigger immutable_agreement_translation on public.seller_agreement_translations;
create trigger immutable_agreement_translation before update on public.seller_agreement_translations
 for each row execute function komisio_private.preserve_agreement_record();
create trigger guard_translation_delete before delete on public.seller_agreement_translations
 for each row execute function komisio_private.guard_agreement_translation_delete();

create or replace function public.publish_seller_agreement(p_tenant uuid,p_id uuid,p_expected_current uuid,p_title text,p_body text,p_language text,p_required boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.seller_agreement_versions;
 current_version public.seller_agreement_versions; t text:=trim(p_title); b text:=trim(p_body);
 published_high integer; next_version integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or t is null or length(t) not between 1 and 120 or b is null or length(b) not between 1 and 12000
 or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') or p_required is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.seller_agreement_versions where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.title is distinct from t or previous.body is distinct from b or previous.language is distinct from p_language
  or previous.required_before_receipt is distinct from p_required then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'AGREEMENT_CHANGED'; end if;
 select coalesce(max((detail->>'version')::integer),0) into published_high from public.access_events
  where tenant_id=p_tenant and action='agreement.published' and detail->>'version' ~ '^[0-9]+$';
 next_version:=greatest(coalesce(current_version.version,0),published_high)+1;
 insert into public.seller_agreement_versions(id,tenant_id,version,title,body,language,required_before_receipt,created_by)
 values(p_id,p_tenant,next_version,t,b,p_language,p_required,uid);
 perform komisio_private.record_access(p_tenant,'agreement.published',p_id,jsonb_build_object('version',next_version));
 return p_id;
end $$;

create function public.seller_agreement_links(p_tenant uuid,p_agreements uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'::jsonb; agreement uuid; usage jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_agreements is null or cardinality(p_agreements)>100 then raise exception 'INVALID_INPUT'; end if;
 foreach agreement in array p_agreements loop
  if agreement is null then raise exception 'INVALID_INPUT'; end if;
  if exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant and id=agreement) then
   usage:=komisio_private.seller_agreement_usage(p_tenant,agreement);
   if usage<>'{}'::jsonb then result:=result||jsonb_build_object(agreement::text,usage); end if;
  end if;
 end loop;
 return result;
end $$;

create function public.delete_unused_seller_agreement(p_tenant uuid,p_agreement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare usage jsonb;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_agreement is null then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant and id=p_agreement) then
  return jsonb_build_object('ok',true,'agreementId',p_agreement);
 end if;
 usage:=komisio_private.seller_agreement_usage(p_tenant,p_agreement);
 if usage<>'{}'::jsonb then return jsonb_build_object('ok',false,'usage',usage); end if;
 delete from public.seller_agreement_versions where tenant_id=p_tenant and id=p_agreement;
 return jsonb_build_object('ok',true,'agreementId',p_agreement);
end $$;
revoke all on function public.delete_unused_seller_agreement(uuid,uuid),public.seller_agreement_links(uuid,uuid[]) from public,anon;
grant execute on function public.delete_unused_seller_agreement(uuid,uuid),public.seller_agreement_links(uuid,uuid[]) to authenticated;
