-- Explicit phone ownership is separate from the existing email identity model.
alter table public.sellers add column external_owner_id uuid references auth.users(id);
create unique index seller_external_owner on public.sellers(tenant_id,external_owner_id) where external_owner_id is not null;
create function komisio_private.preserve_external_seller_owner() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.external_owner_id is distinct from old.external_owner_id then raise exception 'IMMUTABLE_SELLER_IDENTITY'; end if;
 return new;
end $$;
revoke all on function komisio_private.preserve_external_seller_owner() from public,anon,authenticated;
create trigger external_seller_owner_immutable before update on public.sellers
 for each row execute function komisio_private.preserve_external_seller_owner();

-- Contact email on an explicitly owned seller is never an authentication claim.
-- The private view is used only inside existing definer functions; callers get
-- no view access, and ordinary staff reads continue to use the sellers table.
create view komisio_private.email_identified_sellers as
 select * from public.sellers where external_owner_id is null;
revoke all on komisio_private.email_identified_sellers from public,anon,authenticated;
do $$ declare signature text; definition text; changed text; begin
 foreach signature in array array[
  'komisio_private.require_seller(uuid,uuid)',
  'public.my_seller_accounts()',
  'komisio_private.require_store_seller(uuid)',
  'public.catalogue_photo_access(text,text)',
  'public.seller_registration_entry(text,text)',
  'public.submit_seller_registration_in_language(text,uuid,text,text,uuid,uuid,boolean,uuid,text)',
  'public.store_seller_registrations(uuid,integer)',
  'public.review_seller_registration(uuid,uuid,uuid,boolean)',
  'public.set_my_push_device(uuid,text,uuid,integer,text,text,text,boolean)',
  'komisio_private.enqueue_seller_push()',
  'komisio_private.seller_push_eligible(uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(replace(definition,'from public.sellers','from komisio_private.email_identified_sellers'),'join public.sellers','join komisio_private.email_identified_sellers');
  if changed=definition then raise exception 'UNEXPECTED_SELLER_IDENTITY_FUNCTION: %',signature; end if;
  execute changed;
 end loop;
end $$;

-- Legacy cross-store transfer may copy or match contact email/phone. An explicit
-- identity must never be converted to that older ownership model by a transfer.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.transfer_item(uuid,uuid,uuid,uuid,text)'::regprocedure);
 if position('if src.email<>'''' then' in definition)=0 then raise exception 'UNEXPECTED_TRANSFER_FUNCTION'; end if;
 definition:=replace(definition,'if src.email<>'''' then',
  'if src.external_owner_id is not null then raise exception ''EXPLICIT_SELLER_IDENTITY''; end if;
   if src.email<>'''' then');
 definition:=replace(definition,'where tenant_id=p_to and lower(email)=lower(src.email)',
  'where tenant_id=p_to and external_owner_id is null and lower(email)=lower(src.email)');
 definition:=replace(definition,'where tenant_id=p_to and phone=src.phone',
  'where tenant_id=p_to and external_owner_id is null and phone=src.phone');
 execute definition;
end $$;
