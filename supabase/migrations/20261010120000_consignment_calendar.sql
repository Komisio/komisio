-- Optional receipt-based calendar periods. Existing receipts are never backfilled.
-- Preserve the complete existing validator, including fields added after S1.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_calendar(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_calendar(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare p jsonb;
begin
 if not komisio_private.valid_store_policy_before_calendar(value-'consignmentPeriod') then return false; end if;
 if not (value ? 'consignmentPeriod') then return true; end if;
 p:=value->'consignmentPeriod';
 if jsonb_typeof(p)<>'object' or not(p ?& array['months','collectionDays']) or p-array['months','collectionDays']<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(p->'months')<>'number' or jsonb_typeof(p->'collectionDays')<>'number' then return false; end if;
 return (p->>'months')::numeric between 1 and 36 and (p->>'months')::numeric=trunc((p->>'months')::numeric)
  and (p->>'collectionDays')::numeric between 0 and 365 and (p->>'collectionDays')::numeric=trunc((p->>'collectionDays')::numeric);
end $$;

create function komisio_private.consignment_month_end(p_anchor timestamptz,p_months integer) returns timestamptz
language sql immutable strict set search_path='' as $$
 select ((p_anchor at time zone 'Europe/Stockholm')+make_interval(months=>p_months)) at time zone 'Europe/Stockholm'
$$;
revoke all on function komisio_private.consignment_month_end(timestamptz,integer) from public,anon,authenticated;

create table public.consignment_receipt_periods (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 bag_id uuid,
 garment_id uuid,
 policy_id uuid not null,
 received_at timestamptz not null check(isfinite(received_at)),
 sale_ends_at timestamptz not null check(isfinite(sale_ends_at)),
 collection_ends_at timestamptz not null check(isfinite(collection_ends_at)),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,bag_id), unique(tenant_id,garment_id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,bag_id) references public.bag_receipts(tenant_id,id),
 foreign key(tenant_id,garment_id) references public.garment_receipts(tenant_id,id),
 foreign key(tenant_id,policy_id) references public.store_policy_versions(tenant_id,id),
 check((bag_id is null)<>(garment_id is null)),
 check(sale_ends_at>received_at and collection_ends_at>=sale_ends_at)
);
create index consignment_receipt_seller on public.consignment_receipt_periods(tenant_id,seller_id,received_at);
alter table public.consignment_receipt_periods enable row level security;
revoke all on public.consignment_receipt_periods from public,anon,authenticated;
grant select on public.consignment_receipt_periods to authenticated;
create policy consignment_receipt_read on public.consignment_receipt_periods for select to authenticated
 using(tenant_id in(select public.user_tenant_ids()));
create function komisio_private.preserve_consignment_period() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_CONSIGNMENT_PERIOD' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_consignment_period() from public,anon,authenticated;
create trigger consignment_receipt_immutable before update or delete on public.consignment_receipt_periods
 for each row execute function komisio_private.preserve_consignment_period();

-- These triggers run inside the existing engine custody transaction and tenant lock.
create function komisio_private.freeze_consignment_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare pol public.store_policy_versions; seller uuid; bag uuid; garment uuid; ends timestamptz;
begin
 if tg_table_name='bag_receipts' then seller:=new.seller_id; bag:=new.id;
 else
  select s.seller_id,s.bag_id into seller,bag from public.reception_sessions s where s.tenant_id=new.tenant_id and s.id=new.session_id;
  -- Bag-linked reception inherits the original bag's snapshot, including its absence.
  if bag is not null then return new; end if;
  garment:=new.id;
 end if;
 select * into pol from public.store_policy_versions where tenant_id=new.tenant_id order by version desc limit 1;
 if not coalesce(pol.policy ? 'consignmentPeriod',false) then return new; end if;
 ends:=komisio_private.consignment_month_end(new.received_at,(pol.policy->'consignmentPeriod'->>'months')::integer);
 insert into public.consignment_receipt_periods(tenant_id,seller_id,bag_id,garment_id,policy_id,received_at,sale_ends_at,collection_ends_at,recorded_by)
 values(new.tenant_id,seller,bag,garment,pol.id,new.received_at,ends,
  ((ends at time zone 'Europe/Stockholm')+make_interval(days=>(pol.policy->'consignmentPeriod'->>'collectionDays')::integer)) at time zone 'Europe/Stockholm',new.created_by);
 return new;
end $$;
revoke all on function komisio_private.freeze_consignment_receipt() from public,anon,authenticated;
create trigger freeze_bag_consignment after insert on public.bag_receipts for each row execute function komisio_private.freeze_consignment_receipt();
create trigger freeze_garment_consignment after insert on public.garment_receipts for each row execute function komisio_private.freeze_consignment_receipt();

create function komisio_private.freeze_item_consignment_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare bag uuid; garment uuid; period public.consignment_receipt_periods;
begin
 if new.ownership<>'consignment' then return new; end if;
 if new.custody_kind='bag' then bag:=new.custody_id;
 else
  garment:=new.custody_id;
  select s.bag_id into bag from public.garment_receipts g join public.reception_sessions s on s.tenant_id=g.tenant_id and s.id=g.session_id
   where g.tenant_id=new.tenant_id and g.id=garment;
 end if;
 select * into period from public.consignment_receipt_periods p where p.tenant_id=new.tenant_id and p.seller_id=new.seller_id
  and ((bag is not null and p.bag_id=bag) or (bag is null and p.garment_id=garment));
 if found then
  new.terms:=new.terms||jsonb_build_object('consignmentPeriod',jsonb_build_object('id',period.id,'receiptId',coalesce(period.bag_id,period.garment_id),
   'policyId',period.policy_id,'receivedAt',period.received_at,'saleEndsAt',period.sale_ends_at,'collectionEndsAt',period.collection_ends_at));
 end if;
 return new;
end $$;
revoke all on function komisio_private.freeze_item_consignment_period() from public,anon,authenticated;
create trigger freeze_item_consignment before insert on public.items for each row execute function komisio_private.freeze_item_consignment_period();

-- Preserve legacy behavior verbatim, then overlay only items with frozen calendar terms.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.item_lifecycle(uuid,uuid)'::regprocedure),
  'FUNCTION komisio_private.item_lifecycle(', 'FUNCTION komisio_private.item_lifecycle_before_calendar(');
end $$;
revoke all on function komisio_private.item_lifecycle_before_calendar(uuid,uuid) from public,anon,authenticated;
create or replace function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; terms jsonb; ends timestamptz; collection timestamptz; extra integer;
begin
 facts:=komisio_private.item_lifecycle_before_calendar(p_tenant,p_item);
 select i.terms->'consignmentPeriod' into terms from public.items i where i.tenant_id=p_tenant and i.id=p_item;
 if terms is null then return facts; end if;
 extra:=(facts->>'extensionDays')::integer;
 ends:=(((terms->>'saleEndsAt')::timestamptz at time zone 'Europe/Stockholm')+make_interval(days=>extra)) at time zone 'Europe/Stockholm';
 collection:=(((terms->>'collectionEndsAt')::timestamptz at time zone 'Europe/Stockholm')+make_interval(days=>extra)) at time zone 'Europe/Stockholm';
 return facts||jsonb_build_object('periodEnd',ends,'collectionDeadline',collection,'receivedAt',terms->>'receivedAt',
  'endOfPeriodAction','return','stage',case when (facts->>'sold')::boolean then 'sold' when (facts->>'ended')::boolean then 'ended'
   when ends<=now() then 'period_ended' when facts->>'dueStep' is not null then 'markdown_due'
   when ends<=now()+interval '7 days' then 'period_ending' else 'on_sale' end);
end $$;

create or replace function public.end_sale_period(p_tenant uuid,p_id uuid,p_item uuid,p_action text,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,'')); f jsonb;
begin
 if p_action is null or p_action not in ('charity','return','recycle') or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'period_ended',jsonb_build_object('action',p_action,'note',note)) then return p_id; end if;
 if p_action='recycle' then
  f:=komisio_private.item_lifecycle(p_tenant,p_item);
  if f->>'collectionDeadline' is null or (f->>'collectionDeadline')::timestamptz>now() then raise exception 'COLLECTION_NOT_DUE'; end if;
 end if;
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor)
 values(p_id,p_tenant,p_item,'period_ended',jsonb_build_object('action',p_action,'note',note),uid);
 perform komisio_private.record_access(p_tenant,'item.period_ended',p_item,jsonb_build_object('action',p_action));
 return p_id;
end $$;

-- Extend bounded reads without changing their existing role checks or pagination.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.lifecycle_queue_page(uuid,text,text,integer)'::regprocedure);
 if position('''title'',coalesce(p.maybe_title,' in definition)=0 then raise exception 'UNEXPECTED_LIFECYCLE_QUEUE_DEFINITION'; end if;
 definition:=replace(definition,'''title'',coalesce(p.maybe_title,',
  '''collection_due'',coalesce((komisio_private.item_lifecycle(p_tenant,(p.c).item_id)->>''collectionDeadline'')::timestamptz<=now(),false),''collection_deadline'',komisio_private.item_lifecycle(p_tenant,(p.c).item_id)->>''collectionDeadline'',''title'',coalesce(p.maybe_title,');
 execute definition;
 definition:=pg_get_functiondef('public.my_items_page(uuid,uuid,text,integer)'::regprocedure);
 if position('''periodEnd'',x.f->>''periodEnd'',' in definition)=0 then raise exception 'UNEXPECTED_SELLER_ITEMS_DEFINITION'; end if;
 definition:=replace(definition,'''periodEnd'',x.f->>''periodEnd'',',
  '''periodEnd'',x.f->>''periodEnd'',''collectionDeadline'',x.f->>''collectionDeadline'',');
 execute definition;
end $$;
