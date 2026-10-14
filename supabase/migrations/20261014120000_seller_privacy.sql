-- Owner-approved contact erasure, not blanket deletion of retained evidence.
alter table public.sellers add column privacy_closed_at timestamptz;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.sellers'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%email <>%phone <>%' loop
  execute format('alter table public.sellers drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.sellers add constraint sellers_contact_or_closed check
 ((privacy_closed_at is null and (email<>'' or phone<>'')) or
  (privacy_closed_at is not null and name='Removed seller' and email='' and phone='' and profile is null));

create table public.seller_privacy_events (
 id uuid primary key, tenant_id uuid not null references public.tenants(id), seller_id uuid not null,
 kind text not null check(kind in ('contact_erased','retention_reviewed')),
 preview_revision text not null, retention_reason text not null check(length(trim(retention_reason)) between 10 and 1000),
 review_on date not null check(isfinite(review_on)), snapshot jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 transaction_id text not null default pg_current_xact_id()::text,
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
create unique index seller_contact_erased_once on public.seller_privacy_events(tenant_id,seller_id) where kind='contact_erased';
alter table public.seller_privacy_events enable row level security;
revoke all on public.seller_privacy_events from public,anon,authenticated;
grant select on public.seller_privacy_events to authenticated;
create policy seller_privacy_read on public.seller_privacy_events for select to authenticated
 using(coalesce(public.tenant_role(tenant_id),'') in ('owner','admin'));
create trigger seller_privacy_immutable before update or delete on public.seller_privacy_events
 for each row execute function komisio_private.preserve_operation();

-- Transaction-bound evidence, never a client-settable session flag or an ACL bypass.
create function komisio_private.seller_erasure_authorized(p_tenant uuid,p_seller uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') and exists(
  select 1 from public.seller_privacy_events where tenant_id=p_tenant and seller_id=p_seller
  and kind='contact_erased' and created_by=auth.uid() and transaction_id=pg_current_xact_id()::text);
$$;
revoke all on function komisio_private.seller_erasure_authorized(uuid,uuid) from public,anon,authenticated;

create function komisio_private.guard_closed_seller() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 if new.privacy_closed_at is not null and (not komisio_private.seller_erasure_authorized(old.tenant_id,old.id)
  or (to_jsonb(new)-array['name','email','phone','profile','privacy_closed_at']) is distinct from
     (to_jsonb(old)-array['name','email','phone','profile','privacy_closed_at'])) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_closed_seller() from public,anon,authenticated;
create trigger seller_closed_guard before update on public.sellers for each row execute function komisio_private.guard_closed_seller();

create function komisio_private.guard_seller_profile_erasure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and komisio_private.seller_erasure_authorized(old.tenant_id,old.seller_id) then return old; end if;
 raise exception 'IMMUTABLE_PROFILE' using errcode='55000';
end $$;
revoke all on function komisio_private.guard_seller_profile_erasure() from public,anon,authenticated;
drop trigger seller_profile_immutable on public.seller_profile_versions;
create trigger seller_profile_immutable before update or delete on public.seller_profile_versions
 for each row execute function komisio_private.guard_seller_profile_erasure();

create function komisio_private.guard_review_contact_erasure() returns trigger
language plpgsql security definer set search_path='' as $$
declare seller uuid;
begin
 select seller_id into seller from public.reception_sessions where tenant_id=old.tenant_id and id=old.session_id;
 if tg_op='UPDATE' and new.seller_email='' and
  -- Stored generated price_amount is not populated in a BEFORE trigger;
  -- unchanged suggestions guarantee the recomputed price is unchanged.
  (to_jsonb(new)-array['seller_email','price_amount'])=(to_jsonb(old)-array['seller_email','price_amount']) and
  komisio_private.seller_erasure_authorized(old.tenant_id,seller) then return new; end if;
 raise exception 'IMMUTABLE_RECEPTION' using errcode='55000';
end $$;
revoke all on function komisio_private.guard_review_contact_erasure() from public,anon,authenticated;
drop trigger reception_reviews_immutable on public.reception_reviews;
create trigger reception_reviews_immutable before update or delete on public.reception_reviews
 for each row execute function komisio_private.guard_review_contact_erasure();

-- Keep every existing delivery guard; add one exact, audited content-redaction transition.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.guard_communication()'::regprocedure);
 definition:=regexp_replace(definition,'\mBEGIN\M', $guard$begin
 if tg_op='UPDATE' and old.reference_kind='none' and new.recipient='redacted' and new.subject='Removed' and new.body='Removed'
  and new.provider_message_id='' and new.activation_email_ticket_hash is null
  and (to_jsonb(new)-array['recipient','subject','body','provider_message_id','activation_email_ticket_hash'])=
      (to_jsonb(old)-array['recipient','subject','body','provider_message_id','activation_email_ticket_hash'])
  and komisio_private.seller_erasure_authorized(old.tenant_id,old.seller_id) then return new; end if;
 $guard$, 'i');
 execute definition;
end $$;

create function komisio_private.require_open_seller_row() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Lock order matches every staff engine command and serializes seller-originated inserts too.
 perform 1 from public.tenants where id=new.tenant_id for update;
 if new.seller_id is not null and exists(select 1 from public.sellers
  where tenant_id=new.tenant_id and id=new.seller_id and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 return new;
end $$;
revoke all on function komisio_private.require_open_seller_row() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['bag_receipts','reception_sessions','seller_handovers','seller_submissions','seller_profile_versions',
  'seller_terms_versions','seller_agreement_evidence','seller_communications','items','seller_consignment_periods','payouts'] loop
  execute format('create trigger seller_open_for_new_work before insert on public.%I for each row execute function komisio_private.require_open_seller_row()',t);
 end loop;
end $$;

create function komisio_private.require_open_intake_seller() returns trigger
language plpgsql security definer set search_path='' as $$
declare seller uuid;
begin
 perform 1 from public.tenants where id=new.tenant_id for update;
 if tg_table_name='inspection_draft_revisions' then
  select seller_id into seller from public.bag_receipts where tenant_id=new.tenant_id and id=new.bag_id;
 else
  select seller_id into seller from public.reception_sessions where tenant_id=new.tenant_id and id=new.session_id;
 end if;
 if exists(select 1 from public.sellers where tenant_id=new.tenant_id and id=seller and privacy_closed_at is not null) then raise exception 'SELLER_CLOSED'; end if;
 return new;
end $$;
revoke all on function komisio_private.require_open_intake_seller() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['garment_receipts','reception_source_revisions','reception_reviews','inspection_draft_revisions'] loop
  execute format('create trigger seller_open_for_intake before insert on public.%I for each row execute function komisio_private.require_open_intake_seller()',t);
 end loop;
end $$;

create function public.seller_privacy_preview(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.sellers; balance jsonb; blockers jsonb; counts jsonb; history jsonb; snapshot jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 balance:=komisio_private.seller_balance_facts(p_tenant,p_seller);
 blockers:=jsonb_build_object(
  'balance',(balance->>'availableOre')::numeric<>0 or (balance->>'reservedOre')::numeric<>0,
  'fees',(select count(*) from public.consignment_fees f where f.tenant_id=p_tenant and f.seller_id=p_seller and f.collection='separate'
    and not exists(select 1 from public.consignment_fee_events e where e.tenant_id=p_tenant and e.fee_id=f.id and e.kind in ('paid','reversed'))),
  'payouts',(select count(*) from public.payouts where tenant_id=p_tenant and seller_id=p_seller and status in ('requested','approved')),
  'items',(select count(*) from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller
    and komisio_private.item_lifecycle(p_tenant,i.id)->>'stage' not in ('sold','ended')),
  'bags',(select count(*) from public.bag_receipts b where b.tenant_id=p_tenant and b.seller_id=p_seller and
    coalesce((select state from public.bag_processing_events where tenant_id=p_tenant and bag_id=b.id order by version desc limit 1),'open')<>'completed'),
  'handovers',(select count(*) from public.seller_handovers where tenant_id=p_tenant and seller_id=p_seller and status='open'),
  'garments',(select count(*) from public.garment_receipts g join public.reception_sessions r on r.tenant_id=g.tenant_id and r.id=g.session_id
    where r.tenant_id=p_tenant and r.seller_id=p_seller and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.custody_kind='garment' and i.custody_id=g.id)),
  'messages',(select count(*) from public.seller_communications where tenant_id=p_tenant and seller_id=p_seller and status in ('queued','unconfirmed')),
  'legacyStatements',(select count(*) from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller and seller_contact is null));
 counts:=jsonb_build_object(
  'profiles',(select count(*) from public.seller_profile_versions where tenant_id=p_tenant and seller_id=p_seller),
  'ordinaryMessages',(select count(*) from public.seller_communications where tenant_id=p_tenant and seller_id=p_seller and reference_kind='none'),
  'reviewContacts',(select count(*) from public.reception_reviews rv join public.reception_sessions r on r.tenant_id=rv.tenant_id and r.id=rv.session_id where r.tenant_id=p_tenant and r.seller_id=p_seller and rv.seller_email<>''),
  'statements',(select count(*) from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller),
  'agreements',(select count(*) from public.seller_agreement_evidence where tenant_id=p_tenant and seller_id=p_seller),
  'financialMessages',(select count(*) from public.seller_communications where tenant_id=p_tenant and seller_id=p_seller and reference_kind<>'none'),
  'ledger',(select count(*) from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller),
  'receptions',(select count(*) from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller),
  'submissions',(select count(*) from public.seller_submissions where tenant_id=p_tenant and seller_id=p_seller));
 select coalesce(jsonb_agg(to_jsonb(e)-array['transaction_id','tenant_id','preview_revision','snapshot'] order by created_at desc),'[]') into history
 from public.seller_privacy_events e where tenant_id=p_tenant and seller_id=p_seller;
 snapshot:=jsonb_build_object('sellerId',s.id,'profileRevision',s.profile_revision,'closedAt',s.privacy_closed_at,
  'blockers',blockers,'counts',counts,'balance',balance);
 return snapshot||jsonb_build_object('history',history,'canErase',s.privacy_closed_at is null and not exists(
  select 1 from jsonb_each_text(blockers) where value not in ('0','false')),
  'revision',encode(sha256(convert_to((snapshot||jsonb_build_object('historyCount',jsonb_array_length(history)))::text,'UTF8')),'hex'));
end $$;
revoke all on function public.seller_privacy_preview(uuid,uuid) from public,anon;
grant execute on function public.seller_privacy_preview(uuid,uuid) to authenticated;

create function public.erase_seller_contact(p_tenant uuid,p_id uuid,p_seller uuid,p_revision text,p_reason text,p_review_on date,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_privacy_events; preview jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_confirm is distinct from true or p_reason is null or length(trim(p_reason)) not between 10 and 1000
  or p_review_on is null or not isfinite(p_review_on) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_privacy_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind<>'contact_erased'
   or prior.preview_revision is distinct from p_revision or prior.retention_reason<>trim(p_reason) or prior.review_on<>p_review_on
   or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_review_on<current_date then raise exception 'INVALID_INPUT'; end if;
 preview:=public.seller_privacy_preview(p_tenant,p_seller);
 if preview->>'revision' is distinct from p_revision then raise exception 'PRIVACY_CHANGED'; end if;
 if not (preview->>'canErase')::boolean then raise exception 'PRIVACY_BLOCKED'; end if;
 insert into public.seller_privacy_events(id,tenant_id,seller_id,kind,preview_revision,retention_reason,review_on,snapshot,created_by)
 values(p_id,p_tenant,p_seller,'contact_erased',p_revision,trim(p_reason),p_review_on,preview-'history',uid);
 update public.sellers set name='Removed seller',email='',phone='',profile=null,privacy_closed_at=clock_timestamp()
 where tenant_id=p_tenant and id=p_seller;
 delete from public.seller_profile_versions where tenant_id=p_tenant and seller_id=p_seller;
 update public.reception_reviews rv set seller_email='' from public.reception_sessions r
 where rv.tenant_id=p_tenant and r.tenant_id=p_tenant and rv.session_id=r.id and r.seller_id=p_seller;
 update public.seller_communications set recipient='redacted',subject='Removed',body='Removed',provider_message_id='',activation_email_ticket_hash=null
 where tenant_id=p_tenant and seller_id=p_seller and reference_kind='none';
 perform komisio_private.record_access(p_tenant,'seller.contact_erased',p_seller,jsonb_build_object('eventId',p_id));
 return p_id;
end $$;
revoke all on function public.erase_seller_contact(uuid,uuid,uuid,text,text,date,boolean) from public,anon;
grant execute on function public.erase_seller_contact(uuid,uuid,uuid,text,text,date,boolean) to authenticated;

create function public.review_seller_retention(p_tenant uuid,p_id uuid,p_seller uuid,p_revision text,p_reason text,p_review_on date,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_privacy_events; preview jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_confirm is distinct from true or p_reason is null or length(trim(p_reason)) not between 10 and 1000
  or p_review_on is null or not isfinite(p_review_on) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_privacy_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind<>'retention_reviewed'
   or prior.preview_revision is distinct from p_revision or prior.retention_reason<>trim(p_reason) or prior.review_on<>p_review_on
   or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_review_on<current_date then raise exception 'INVALID_INPUT'; end if;
 preview:=public.seller_privacy_preview(p_tenant,p_seller);
 if preview->>'revision' is distinct from p_revision then raise exception 'PRIVACY_CHANGED'; end if;
 if preview->>'closedAt' is null then raise exception 'PRIVACY_BLOCKED'; end if;
 insert into public.seller_privacy_events(id,tenant_id,seller_id,kind,preview_revision,retention_reason,review_on,snapshot,created_by)
 values(p_id,p_tenant,p_seller,'retention_reviewed',p_revision,trim(p_reason),p_review_on,preview-'history',uid);
 perform komisio_private.record_access(p_tenant,'seller.retention_reviewed',p_seller,jsonb_build_object('eventId',p_id));
 return p_id;
end $$;
revoke all on function public.review_seller_retention(uuid,uuid,uuid,text,text,date,boolean) from public,anon;
grant execute on function public.review_seller_retention(uuid,uuid,uuid,text,text,date,boolean) to authenticated;
