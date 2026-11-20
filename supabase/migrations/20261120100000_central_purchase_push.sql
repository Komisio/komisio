-- Notifications follow immutable credit evidence, independently of the payout method.
alter table komisio_private.seller_push_deliveries drop constraint seller_push_event_shape;
alter table komisio_private.seller_push_deliveries add constraint seller_push_event_shape check (
 (kind in ('item_registered','item_sold') and seller_id is not null and item_id is not null and policy_version is not null and request_id is null and owner_id is null)
 or (kind in ('external_item_offered','external_item_declined','external_item_purchased') and seller_id is null and item_id is null and policy_version is null and request_id is not null and owner_id is not null)
);

create view komisio_private.central_purchase_push_sources as
select credit.id as ledger_id, r.tenant_id, r.id as request_id, r.owner_id
from (
 select p.tenant_id,p.request_id,p.ledger_id from komisio_private.central_direct_purchases p
 union all
 select e.tenant_id,o.request_id,e.ledger_id from public.external_item_guarantee_events e
 join public.external_item_guarantees g on g.tenant_id=e.tenant_id and g.id=e.guarantee_id
 join public.external_item_offers o on o.tenant_id=g.tenant_id and o.id=g.offer_id and o.owner_id=g.owner_id
 where e.kind='credited' and e.sale_line_id is null and exists (
  select 1 from public.external_item_guarantee_events a where a.tenant_id=e.tenant_id and a.guarantee_id=e.guarantee_id and a.kind='acquired')
) fact
join public.external_item_requests r on r.tenant_id=fact.tenant_id and r.id=fact.request_id and r.sender_country='SE'
join public.platform_settings p on p.only_row and p.central_app_tenant_id=r.tenant_id
join public.seller_ledger_entries credit on credit.tenant_id=r.tenant_id and credit.id=fact.ledger_id and credit.amount_ore>0
join public.sellers s on s.tenant_id=credit.tenant_id and s.id=credit.seller_id and s.external_owner_id=r.owner_id and s.privacy_closed_at is null;
revoke all on komisio_private.central_purchase_push_sources from public,anon,authenticated;

create function komisio_private.enqueue_central_purchase_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into komisio_private.seller_push_deliveries(tenant_id,request_id,owner_id,device_id,device_generation,kind,reference_id)
 select s.tenant_id,s.request_id,s.owner_id,d.id,d.generation,'external_item_purchased',s.ledger_id
 from komisio_private.central_purchase_push_sources s
 join komisio_private.seller_push_devices d on d.user_id=s.owner_id and d.enabled
 where s.ledger_id=new.ledger_id and s.tenant_id=new.tenant_id and komisio_private.external_push_session_valid(d.user_id,d.session_id)
 on conflict(device_id,device_generation,kind,reference_id) do nothing;
 return new;
end $$;
revoke all on function komisio_private.enqueue_central_purchase_push() from public,anon,authenticated;
create trigger central_direct_purchase_push after insert on komisio_private.central_direct_purchases
 for each row execute function komisio_private.enqueue_central_purchase_push();
create trigger central_deadline_purchase_push after insert on public.external_item_guarantee_events
 for each row when(new.kind='credited' and new.sale_line_id is null) execute function komisio_private.enqueue_central_purchase_push();

alter function komisio_private.external_push_eligible(uuid) rename to external_decision_push_eligible;
create function komisio_private.external_push_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select komisio_private.external_decision_push_eligible(p_id) or exists(
  select 1 from komisio_private.seller_push_deliveries q
  join komisio_private.central_purchase_push_sources s on s.ledger_id=q.reference_id and s.request_id=q.request_id and s.owner_id=q.owner_id and s.tenant_id=q.tenant_id
  join komisio_private.seller_push_devices d on d.id=q.device_id and d.generation=q.device_generation and d.user_id=s.owner_id
  where q.id=p_id and q.kind='external_item_purchased' and d.enabled and komisio_private.external_push_session_valid(d.user_id,d.session_id))
$$;
revoke all on function komisio_private.external_push_eligible(uuid) from public,anon,authenticated;

-- A customer sale after the central acquisition belongs to the store.
do $$ declare d text; needle text:='if exists(select 1 from public.sale_returns where tenant_id=new.tenant_id and sale_line_id=new.id)'; begin
 d:=pg_get_functiondef('komisio_private.enqueue_central_item_push()'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'UNEXPECTED_CENTRAL_SOLD_PUSH'; end if;
 execute replace(d,needle,'if exists(select 1 from public.external_item_guarantee_events where tenant_id=new.tenant_id and guarantee_id=new.guarantee_id and kind=''acquired'') or '||substr(needle,4));
end $$;

-- Old workers must not see an unsupported kind, even when the queue is full.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.seller_push_candidates(integer)'::regprocedure);
 if strpos(d,'not in (2,3)')=0 or strpos(d,'if p_protocol=3 then')=0
 or strpos(d,'where q.state=''queued'' order by')=0 then raise exception 'UNEXPECTED_PUSH_PROTOCOL'; end if;
 d:=replace(d,'not in (2,3)','not in (2,3,4)');
 d:=replace(d,'if p_protocol=3 then','if p_protocol>=3 then');
 execute replace(d,'where q.state=''queued'' order by','where q.state=''queued'' and (p_protocol=4 or q.kind<>''external_item_purchased'') order by');
end $$;
