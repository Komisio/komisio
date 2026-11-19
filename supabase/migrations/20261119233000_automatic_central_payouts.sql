-- Only staff-assessed requests in the new central flow participate. A preference
-- can change until the item credit creates its immutable destination snapshot.
create table komisio_private.central_payout_preferences (
 tenant_id uuid not null, seller_id uuid not null, version_id uuid not null unique,
 method text not null, swish_phone text, bank_version uuid,
 primary key(tenant_id,seller_id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,bank_version) references public.seller_bank_versions(tenant_id,id) on delete cascade,
 check ((method='swish' and swish_phone is not null and swish_phone ~ '^\+467[023689][0-9]{7}$' and bank_version is null)
     or (method='bank' and swish_phone is null and bank_version is not null))
);
alter table komisio_private.central_payout_preferences enable row level security;
revoke all on komisio_private.central_payout_preferences from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate on komisio_private.central_payout_preferences
 for each statement execute function komisio_private.guard_support_write();

alter table komisio_private.central_payout_destinations add column credit_id uuid unique references public.seller_ledger_entries(id);
alter table public.payouts drop constraint payouts_request_source_check,add constraint payouts_request_source_check check(request_source in ('staff','seller','automatic'));

create function public.save_central_payout_preference(p_tenant uuid,p_seller uuid,p_id uuid,p_expected uuid,p_destination jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_identity_owner(); prev komisio_private.central_payout_preferences;
 method text:=p_destination->>'method'; phone text; bank uuid;
begin
 perform komisio_private.lock_external_owner(uid);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if p_tenant is distinct from (public.public_central_app_recipient()->>'id')::uuid or not exists(
  select 1 from public.sellers where id=p_seller and tenant_id=p_tenant and external_owner_id=uid and privacy_closed_at is null)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or jsonb_typeof(p_destination) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if method='swish' and jsonb_typeof(p_destination->'phone')='string' and p_destination-'method'-'phone'='{}'::jsonb then
  phone:=p_destination->>'phone';
  if phone !~ '^\+467[023689][0-9]{7}$' then raise exception 'INVALID_INPUT'; end if;
 elsif method='bank' and jsonb_typeof(p_destination->'bankVersionId')='string' and p_destination-'method'-'bankVersionId'='{}'::jsonb then
  if (p_destination->>'bankVersionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_INPUT'; end if;
  bank:=(p_destination->>'bankVersionId')::uuid;
 else raise exception 'INVALID_INPUT'; end if;
 select * into prev from komisio_private.central_payout_preferences where tenant_id=p_tenant and seller_id=p_seller;
 if prev.version_id=p_id then
  if (prev.method,prev.swish_phone,prev.bank_version) is distinct from (method,phone,bank) then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if prev.version_id is distinct from p_expected then raise exception 'PROFILE_CHANGED'; end if;
 if bank is not null and bank is distinct from (select id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1) then raise exception 'BANK_DETAILS_CHANGED'; end if;
 perform komisio_private.require_writable(p_tenant);
 insert into komisio_private.central_payout_preferences(tenant_id,seller_id,version_id,method,swish_phone,bank_version) values(p_tenant,p_seller,p_id,method,phone,bank)
 on conflict(tenant_id,seller_id) do update set version_id=excluded.version_id,method=excluded.method,swish_phone=excluded.swish_phone,bank_version=excluded.bank_version;
 return p_id;
end $$;
revoke all on function public.save_central_payout_preference(uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_central_payout_preference(uuid,uuid,uuid,uuid,jsonb) to authenticated;

-- Clear reusable contact data when the seller closes. Existing payout evidence
-- keeps its separate financial retention rules.
create function komisio_private.close_central_payout_preference() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from komisio_private.central_payout_preferences where tenant_id=new.tenant_id and seller_id=new.id; return new; end $$;
revoke all on function komisio_private.close_central_payout_preference() from public,anon,authenticated;
create trigger close_central_payout_preference after update of privacy_closed_at on public.sellers for each row
 when (old.privacy_closed_at is null and new.privacy_closed_at is not null) execute function komisio_private.close_central_payout_preference();

create function komisio_private.require_central_payout_preference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from komisio_private.central_payout_preferences where tenant_id=new.tenant_id and seller_id=new.seller_id) then raise exception 'PAYOUT_PREFERENCE_REQUIRED'; end if;
 return new;
end $$;
revoke all on function komisio_private.require_central_payout_preference() from public,anon,authenticated;
create trigger central_submission_destination before insert on public.external_item_requests for each row
 when (new.sale_method='staff_decides') execute function komisio_private.require_central_payout_preference();

create function komisio_private.queue_central_item_payout() returns trigger language plpgsql security definer set search_path='' as $$
declare req uuid; pref komisio_private.central_payout_preferences; credit public.seller_ledger_entries; payout uuid;
begin
 if tg_table_name='central_direct_purchases' then req:=new.request_id;
 else select o.request_id into strict req from public.external_item_guarantees g join public.external_item_offers o on o.id=g.offer_id where g.id=new.guarantee_id and o.tenant_id=new.tenant_id; end if;
 if not exists(select 1 from public.external_item_requests r where r.id=req and r.tenant_id=new.tenant_id and r.sale_method='staff_decides') then return new; end if;
 select * into strict credit from public.seller_ledger_entries where id=new.ledger_id and tenant_id=new.tenant_id and kind in ('credit_sale','credit_purchase','credit_guarantee') and amount_ore>0;
 select * into strict pref from komisio_private.central_payout_preferences where tenant_id=credit.tenant_id and seller_id=credit.seller_id;
 payout:=komisio_private.derived_id('automatic-central-item-payout:'||req::text);
 insert into komisio_private.central_payout_destinations(payout_id,tenant_id,seller_id,method,swish_phone,bank_version,credit_id)
 values(payout,credit.tenant_id,credit.seller_id,pref.method,pref.swish_phone,pref.bank_version,credit.id);
 insert into public.payouts(id,tenant_id,seller_id,amount_ore,currency,requested_by,request_source)
 values(payout,credit.tenant_id,credit.seller_id,credit.amount_ore,'SEK',credit.recorded_by,'automatic');
 insert into public.payout_events(id,tenant_id,payout_id,kind,actor) values(payout,credit.tenant_id,payout,'requested',credit.recorded_by);
 perform komisio_private.record_access(credit.tenant_id,'payout.requested',payout,jsonb_build_object('source','automatic','itemRequestId',req,'creditId',credit.id));
 return new;
end $$;
revoke all on function komisio_private.queue_central_item_payout() from public,anon,authenticated;
create trigger queue_central_item_payout after insert on komisio_private.central_direct_purchases for each row execute function komisio_private.queue_central_item_payout();
create trigger queue_central_item_payout after insert on public.external_item_guarantee_events for each row when(new.kind='credited') execute function komisio_private.queue_central_item_payout();

do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('public.read_central_intake_profile()'::regprocedure);
 needle:='return jsonb_build_object(''tenantId'',tid';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PROFILE_READ'; end if;
 execute replace(d,needle,$body$return jsonb_build_object('payoutPreference',(select jsonb_build_object('id',p.version_id,'method',p.method,'phone',p.swish_phone,'bankVersionId',p.bank_version,
 'bankLastFour',(select right(b.details->>'account',4) from public.seller_bank_versions b where b.tenant_id=p.tenant_id and b.id=p.bank_version)) from komisio_private.central_payout_preferences p
 where p.tenant_id=tid and p.seller_id=(account->>'sellerId')::uuid),
 'payoutBank',(select jsonb_build_object('id',id,'lastFour',right(details->>'account',4)) from public.seller_bank_versions
 where tenant_id=tid and seller_id=(account->>'sellerId')::uuid order by seq desc limit 1),'tenantId',tid$body$);
 d:=pg_get_functiondef('public.my_seller_payouts_page(uuid,uuid,integer)'::regprocedure);
 needle:='select id,amount_ore,status,request_source,requested_at';
 if position(needle in d)=0 or position('''centralPayout'',jsonb_build_object(''enabled'',true' in d)=0 then raise exception 'UNEXPECTED_PAYOUT_PAGE'; end if;
 -- The stable mobile projection keeps its established source vocabulary.
 d:=replace(d,needle,'select id,amount_ore,status,case when request_source=''automatic'' then ''staff'' else request_source end as request_source,(request_source=''automatic'') as automatic,requested_at');
 execute replace(d,'''centralPayout'',jsonb_build_object(''enabled'',true','''centralPayout'',jsonb_build_object(''enabled'',true,''automatic'',true');
 d:=pg_get_functiondef('komisio_private.request_payout_core(uuid,uuid,uuid,bigint,text)'::regprocedure);
 needle:='threshold:=komisio_private.payout_threshold_ore(p_tenant);';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_MANUAL_ENTRY'; end if;
 execute replace(d,needle,'if exists(select 1 from public.external_item_requests where tenant_id=p_tenant and seller_id=p_seller and sale_method=''staff_decides'') then raise exception ''PAYOUT_AUTOMATIC''; end if;
 '||needle);
end $$;
do $$ declare d text; needle text:='''items'',(select count(*) from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller'; begin
 d:=pg_get_functiondef('public.seller_privacy_preview(uuid,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PRIVACY_PREVIEW'; end if;
 execute replace(d,needle,'''items'',(select count(*) from public.external_item_requests r where r.tenant_id=p_tenant and r.seller_id=p_seller and r.sale_method=''staff_decides''
 and komisio_private.external_request_state(r.id) in (''waiting'',''accepted'',''open'',''received'')) + (select count(*) from public.items i where i.tenant_id=p_tenant and i.seller_id=p_seller');
end $$;
-- An inspected item may still be awaiting a staff choice at the deadline.
-- Reuse the existing day-45 acquisition; never backdate a direct purchase.
do $$ declare d text:=pg_get_functiondef('public.run_central_guarantees(uuid)'::regprocedure);
 needle text:='for g in select x.id from public.external_item_guarantees x'; begin
 if position(needle in d)=0 then raise exception 'UNEXPECTED_GUARANTEE_WORKER'; end if;
 execute replace(d,needle,$body$for g in
  select r.id,l.handover_id from public.external_item_requests r
  join public.external_item_offers o on o.request_id=r.id and o.tenant_id=r.tenant_id and o.approval_source='fixed_request'
  join public.external_item_handover_links l on l.tenant_id=r.tenant_id and l.offer_id=o.id
  join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=r.tenant_id
  where r.tenant_id=p_tenant and r.sale_method='staff_decides' and h.status='received' and h.received_at<=at_time-interval '1080 hours'
  and komisio_private.resolved_central_sale_method(r.id,r.sale_method) is null order by h.received_at,r.id limit 100
 loop perform komisio_private.ensure_external_item_guarantees(p_tenant,g.handover_id,g.id); end loop;
 for g in select x.id from public.external_item_guarantees x$body$);
end $$;
notify pgrst,'reload schema';
