-- A promise starts with actual custody, not with later inventory registration.
-- Fulfillment evidence is separate; this migration never books money or a sale.
create table public.external_item_guarantees (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 offer_id uuid not null unique,
 handover_link_id uuid not null unique references public.external_item_handover_links(id),
 owner_id uuid not null references auth.users(id),
 seller_id uuid not null,
 handover_id uuid not null,
 bag_id uuid not null,
 amount_ore numeric(12,0) not null check(amount_ore>0 and amount_ore<=99999999999),
 currency text not null check(currency='SEK'),
 received_at timestamptz not null check(isfinite(received_at)),
 due_at timestamptz not null check(isfinite(due_at) and due_at=received_at+interval '1080 hours'),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),
 foreign key(tenant_id,offer_id,owner_id) references public.external_item_offers(tenant_id,id,owner_id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,handover_id) references public.seller_handovers(tenant_id,id),
 foreign key(tenant_id,bag_id) references public.bag_receipts(tenant_id,id)
);
create index external_guarantees_owner on public.external_item_guarantees(owner_id,received_at desc,id);
create index external_guarantees_due on public.external_item_guarantees(tenant_id,due_at,id);

create table public.external_item_guarantee_events (
 id uuid primary key,
 tenant_id uuid not null,
 guarantee_id uuid not null,
 kind text not null check(kind in ('registered','sold','acquired','credited','returned')),
 item_id uuid not null,
 sale_line_id uuid references public.sale_lines(id),
 purchase_id uuid,
 ledger_id uuid unique references public.seller_ledger_entries(id),
 return_id uuid unique references public.sale_returns(id),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,guarantee_id) references public.external_item_guarantees(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 foreign key(tenant_id,purchase_id) references public.purchase_receipts(tenant_id,id),
 check(case kind
  when 'registered' then sale_line_id is null and purchase_id is null and ledger_id is null and return_id is null
  when 'sold' then sale_line_id is not null and purchase_id is null and ledger_id is null and return_id is null
  when 'acquired' then purchase_id is not null and sale_line_id is null and ledger_id is null and return_id is null
  when 'credited' then ledger_id is not null and (sale_line_id is null)<>(purchase_id is null) and return_id is null
  when 'returned' then return_id is not null and sale_line_id is not null and purchase_id is null and ledger_id is null
  else false end)
);
-- A return does not release this uniqueness constraint. Resales may have more
-- sale events, but the fixed promise has only one credited fulfillment.
create unique index external_guarantee_once on public.external_item_guarantee_events(guarantee_id,kind)
 where kind in ('registered','acquired','credited');
create unique index external_guarantee_item_once on public.external_item_guarantee_events(item_id) where kind='registered';
create unique index external_guarantee_sale_once on public.external_item_guarantee_events(sale_line_id,kind) where sale_line_id is not null;
create unique index external_guarantee_purchase_once on public.external_item_guarantee_events(purchase_id,kind) where purchase_id is not null;
create index external_guarantee_events_read on public.external_item_guarantee_events(tenant_id,guarantee_id,recorded_at,id);

alter table public.external_item_guarantees enable row level security;
alter table public.external_item_guarantee_events enable row level security;
revoke all on public.external_item_guarantees,public.external_item_guarantee_events from public,anon,authenticated;
grant select on public.external_item_guarantees,public.external_item_guarantee_events to authenticated;
create policy guarantee_read on public.external_item_guarantees for select to authenticated
 using((owner_id=auth.uid() and public.external_phone_verified()) or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy guarantee_event_read on public.external_item_guarantee_events for select to authenticated
 using(exists(select 1 from public.external_item_guarantees g where g.tenant_id=external_item_guarantee_events.tenant_id and g.id=guarantee_id));

create function komisio_private.validate_external_guarantee() returns trigger
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.external_item_handover_links l
  join public.external_item_offers o on o.id=l.offer_id and o.tenant_id=l.tenant_id and o.owner_id=l.owner_id
  join public.external_item_offer_responses a on a.offer_id=o.id and a.accepted
  join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=l.tenant_id
  join public.bag_receipts b on b.id=h.received_bag_id and b.tenant_id=h.tenant_id and b.seller_id=l.seller_id
  where l.id=new.handover_link_id and l.tenant_id=new.tenant_id and l.owner_id=new.owner_id
   and l.seller_id=new.seller_id and o.id=new.offer_id and o.seller_amount_ore=new.amount_ore and o.currency=new.currency
   and h.id=new.handover_id and h.status='received' and h.received_at=new.received_at
   and b.id=new.bag_id and b.created_by=new.recorded_by
   and b.agreement_version_id=l.agreement_id and b.agreement_evidence_id=l.evidence_id)
 then raise exception 'GUARANTEE_EVIDENCE_REQUIRED'; end if;
 return new;
end $$;

create function komisio_private.validate_external_guarantee_event() returns trigger
language plpgsql set search_path='' as $$
declare g public.external_item_guarantees; registration uuid;
begin
 select * into g from public.external_item_guarantees where tenant_id=new.tenant_id and id=new.guarantee_id;
 if g.id is null then raise exception 'GUARANTEE_EVIDENCE_REQUIRED'; end if;
 if new.kind='registered' then
  if not exists(select 1 from public.items i where i.tenant_id=g.tenant_id and i.id=new.item_id and i.seller_id=g.seller_id
   and (i.custody_kind='bag' and i.custody_id=g.bag_id or i.custody_kind='garment' and exists(
    select 1 from public.garment_receipts r join public.reception_sessions s on s.tenant_id=r.tenant_id and s.id=r.session_id
    where r.tenant_id=g.tenant_id and r.id=i.custody_id and s.bag_id=g.bag_id)))
  then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 else
  select item_id into registration from public.external_item_guarantee_events where guarantee_id=g.id and kind='registered';
  if registration is distinct from new.item_id then raise exception 'GUARANTEE_ITEM_MISMATCH'; end if;
 end if;
 if new.sale_line_id is not null and not exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=g.tenant_id and l.id=new.sale_line_id and l.item_id=new.item_id and s.status='completed')
 then raise exception 'GUARANTEE_SALE_MISMATCH'; end if;
 if new.purchase_id is not null and not exists(select 1 from public.purchase_receipts p where p.tenant_id=g.tenant_id and p.id=new.purchase_id
  and p.purchase_price_ore=g.amount_ore and p.currency=g.currency)
 then raise exception 'GUARANTEE_PURCHASE_MISMATCH'; end if;
 if new.ledger_id is not null and not exists(select 1 from public.seller_ledger_entries l where l.tenant_id=g.tenant_id and l.id=new.ledger_id
  and l.seller_id=g.seller_id and l.amount_ore=g.amount_ore and l.reference_id=coalesce(new.sale_line_id,new.purchase_id)
  and l.reference_kind=case when new.sale_line_id is not null then 'sale_line' else 'purchase_receipt' end)
 then raise exception 'GUARANTEE_CREDIT_MISMATCH'; end if;
 if new.return_id is not null and not exists(select 1 from public.sale_returns r where r.tenant_id=g.tenant_id and r.id=new.return_id
  and r.item_id=new.item_id and r.sale_line_id=new.sale_line_id)
 then raise exception 'GUARANTEE_RETURN_MISMATCH'; end if;
 return new;
end $$;
create trigger guarantee_evidence before insert on public.external_item_guarantees for each row execute function komisio_private.validate_external_guarantee();
create trigger guarantee_event_evidence before insert on public.external_item_guarantee_events for each row execute function komisio_private.validate_external_guarantee_event();
create trigger immutable_record before update or delete on public.external_item_guarantees for each row execute function komisio_private.preserve_agreement_record();
create trigger immutable_record before update or delete on public.external_item_guarantee_events for each row execute function komisio_private.preserve_agreement_record();
create trigger support_read_only_guard before insert or update or delete or truncate on public.external_item_guarantees for each statement execute function komisio_private.guard_support_write();
create trigger support_read_only_guard before insert or update or delete or truncate on public.external_item_guarantee_events for each statement execute function komisio_private.guard_support_write();
create trigger plan_gate before insert on public.external_item_guarantees for each row execute function komisio_private.plan_gate();
create trigger plan_gate before insert on public.external_item_guarantee_events for each row execute function komisio_private.plan_gate();

create function komisio_private.ensure_external_item_guarantees(p_tenant uuid,p_handover uuid) returns void
language plpgsql security definer set search_path='' as $$
declare promise record;
begin
 for promise in
  insert into public.external_item_guarantees(id,tenant_id,offer_id,handover_link_id,owner_id,seller_id,handover_id,bag_id,amount_ore,currency,received_at,due_at,recorded_by)
  select komisio_private.derived_id(o.id::text||':guarantee'),l.tenant_id,o.id,l.id,l.owner_id,l.seller_id,h.id,b.id,o.seller_amount_ore,o.currency,h.received_at,h.received_at+interval '1080 hours',b.created_by
  from public.external_item_handover_links l join public.external_item_offers o on o.id=l.offer_id and o.tenant_id=l.tenant_id
  join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=l.tenant_id
  join public.bag_receipts b on b.id=h.received_bag_id and b.tenant_id=h.tenant_id
  where l.tenant_id=p_tenant and l.handover_id=p_handover and h.status='received'
   and not exists(select 1 from public.external_item_guarantees g where g.offer_id=o.id)
  returning id
 loop
  perform komisio_private.record_access(p_tenant,'external_item.guarantee_frozen',promise.id,jsonb_build_object('handoverId',p_handover));
 end loop;
end $$;

-- Preserve receipt authorization, exact retries and the ordinary-store path.
alter function public.receive_handover(uuid,uuid,uuid,text,text) set schema komisio_private;
alter function komisio_private.receive_handover(uuid,uuid,uuid,text,text) rename to receive_handover_before_guarantees;
revoke all on function komisio_private.receive_handover_before_guarantees(uuid,uuid,uuid,text,text) from public,anon,authenticated;
create function public.receive_handover(p_tenant uuid,p_id uuid,p_handover uuid,p_source text,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare receipt uuid;
begin
 receipt:=komisio_private.receive_handover_before_guarantees(p_tenant,p_id,p_handover,p_source,p_note);
 perform komisio_private.ensure_external_item_guarantees(p_tenant,p_handover);
 return receipt;
end $$;
revoke all on function public.receive_handover(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.receive_handover(uuid,uuid,uuid,text,text) to authenticated;
revoke all on function komisio_private.ensure_external_item_guarantees(uuid,uuid),komisio_private.validate_external_guarantee(),komisio_private.validate_external_guarantee_event() from public,anon,authenticated;

do $$ declare definition text; needle text:='''agreement'',jsonb_build_object'; begin
 definition:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_OFFER_READ'; end if;
 execute replace(definition,needle,
  '''guarantee'',(select jsonb_build_object(''id'',g.id,''amountOre'',g.amount_ore::text,''currency'',g.currency,
    ''receivedAt'',g.received_at,''dueAt'',g.due_at,''creditedAt'',(select l.occurred_at from public.external_item_guarantee_events e
      join public.seller_ledger_entries l on l.id=e.ledger_id and l.tenant_id=e.tenant_id where e.guarantee_id=g.id and e.kind=''credited''))
    from public.external_item_guarantees g where g.offer_id=offer.id and g.tenant_id=offer.tenant_id and g.owner_id=offer.owner_id),
   '||needle);
end $$;
