-- P3 self drop-off: a seller announces a handover (a bag or a box) from the
-- seller portal, gets a reference H-n, and the store records custody by
-- receiving it: staff at the counter, or a locker integration later. Receiving
-- creates the ordinary bag receipt under the same agreement rules, so nothing
-- downstream changes. The owner approved this table on 2026-09-13. Enabled per
-- store by the policy's custodySources containing seller_dropoff.
create table public.seller_handovers (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 reference bigint generated always as identity unique,
 kind text not null check(kind in ('bag','box')),
 estimated_items integer not null check(estimated_items between 0 and 500),
 note text not null default '' check(length(note)<=500),
 status text not null default 'open' check(status in ('open','received','cancelled')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 received_bag_id uuid,
 received_at timestamptz,
 custody_source text check(custody_source in ('staff_receipt','locker')),
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,received_bag_id) references public.bag_receipts(tenant_id,id),
 check((status='received')=(received_bag_id is not null)),
 check((status='received')=(received_at is not null)),
 check((status='received')=(custody_source is not null))
);
create index seller_handovers_tenant on public.seller_handovers(tenant_id,status,created_at desc);
create index seller_handovers_seller on public.seller_handovers(tenant_id,seller_id,created_at desc);
create table public.handover_events (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 handover_id uuid not null,
 kind text not null check(kind in ('created','received','cancelled')),
 note text not null default '' check(length(note)<=500),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 foreign key(tenant_id,handover_id) references public.seller_handovers(tenant_id,id)
);
create index handover_events_handover on public.handover_events(tenant_id,handover_id,occurred_at);
alter table public.seller_handovers enable row level security;
alter table public.handover_events enable row level security;
revoke all on public.seller_handovers,public.handover_events from public,anon,authenticated;
grant select on public.seller_handovers,public.handover_events to authenticated;
create policy seller_handovers_read on public.seller_handovers for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy handover_events_read on public.handover_events for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
-- Status moves only inside an engine transition; the announcement itself never changes.
create function komisio_private.guard_handover() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.handover_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_HANDOVER' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.seller_id<>old.seller_id or new.kind<>old.kind or new.estimated_items<>old.estimated_items or new.note<>old.note or new.created_by<>old.created_by or new.created_at<>old.created_at or old.status<>'open' then raise exception 'IMMUTABLE_HANDOVER' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_handover() from public,anon,authenticated;
create trigger seller_handovers_guard before update or delete on public.seller_handovers for each row execute function komisio_private.guard_handover();
create trigger handover_events_immutable before update or delete on public.handover_events for each row execute function komisio_private.preserve_payout_event();

create function komisio_private.custody_source_allowed(p_tenant uuid,p_source text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from jsonb_array_elements_text(coalesce((select policy->'custodySources' from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1),'["staff_receipt"]'::jsonb)) s where s=p_source);
$$;
revoke all on function komisio_private.custody_source_allowed(uuid,text) from public,anon,authenticated;

-- The seller announces; only when the store allows self drop-off.
create function public.create_my_handover(p_tenant uuid,p_id uuid,p_seller uuid,p_kind text,p_estimated_items integer,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_handovers; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_kind not in ('bag','box') or p_estimated_items is null or p_estimated_items not between 0 and 500 or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_handovers where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind is distinct from p_kind or prior.estimated_items is distinct from p_estimated_items or prior.note is distinct from n or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not komisio_private.custody_source_allowed(p_tenant,'seller_dropoff') then raise exception 'HANDOVER_NOT_ENABLED'; end if;
 insert into public.seller_handovers(id,tenant_id,seller_id,kind,estimated_items,note,created_by) values(p_id,p_tenant,p_seller,p_kind,p_estimated_items,n,uid);
 insert into public.handover_events(id,tenant_id,handover_id,kind,actor) values(p_id,p_tenant,p_id,'created',uid);
 perform komisio_private.record_access(p_tenant,'handover.created',p_id,jsonb_build_object('seller_id',p_seller,'kind',p_kind));
 return p_id;
end $$;

create function public.cancel_my_handover(p_tenant uuid,p_id uuid,p_handover uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.handover_events; h public.seller_handovers;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into h from public.seller_handovers where tenant_id=p_tenant and id=p_handover;
 if not found then raise exception 'HANDOVER_NOT_FOUND'; end if;
 uid:=komisio_private.require_seller(p_tenant,h.seller_id);
 if p_id is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.handover_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.handover_id is distinct from p_handover or prior.kind is distinct from 'cancelled' or prior.actor is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if h.status<>'open' then raise exception 'HANDOVER_DECIDED'; end if;
 perform set_config('komisio.handover_transition','engine',true);
 update public.seller_handovers set status='cancelled' where id=h.id;
 perform set_config('komisio.handover_transition','',true);
 insert into public.handover_events(id,tenant_id,handover_id,kind,actor) values(p_id,p_tenant,h.id,'cancelled',uid);
 perform komisio_private.record_access(p_tenant,'handover.cancelled',h.id,'{}'::jsonb);
 return p_id;
end $$;

-- The store records custody: the ordinary bag receipt under the current
-- agreement rules, then the handover is received. A locker integration calls
-- the same command with source locker, allowed only when the policy lists it.
create function public.receive_handover(p_tenant uuid,p_id uuid,p_handover uuid,p_source text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.handover_events; h public.seller_handovers; bag uuid; agreement uuid; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_handover is null or p_source not in ('staff_receipt','locker') or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.handover_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.handover_id is distinct from p_handover or prior.kind is distinct from 'received' or prior.actor is distinct from uid or prior.note is distinct from n then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into h from public.seller_handovers where tenant_id=p_tenant and id=p_handover;
 if not found then raise exception 'HANDOVER_NOT_FOUND'; end if;
 if h.status<>'open' then raise exception 'HANDOVER_DECIDED'; end if;
 if p_source='locker' and not komisio_private.custody_source_allowed(p_tenant,'locker') then raise exception 'CUSTODY_SOURCE_NOT_ALLOWED'; end if;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 bag:=md5(h.id::text||':received')::uuid;
 perform public.receive_bag_with_agreement(p_tenant,bag,h.seller_id,case when n='' then 'H-'||h.reference else n end,agreement);
 perform set_config('komisio.handover_transition','engine',true);
 update public.seller_handovers set status='received',received_bag_id=bag,received_at=now(),custody_source=p_source where id=h.id;
 perform set_config('komisio.handover_transition','',true);
 insert into public.handover_events(id,tenant_id,handover_id,kind,note,actor) values(p_id,p_tenant,h.id,'received',n,uid);
 perform komisio_private.record_access(p_tenant,'handover.received',h.id,jsonb_build_object('bag_id',bag,'custody_source',p_source));
 return p_id;
end $$;

create function public.my_handovers(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 return jsonb_build_object(
  'enabled',komisio_private.custody_source_allowed(p_tenant,'seller_dropoff'),
  'handovers',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'reference','H-'||h.reference,'kind',h.kind,'estimatedItems',h.estimated_items,'note',h.note,'status',h.status,'createdAt',h.created_at,'receivedAt',h.received_at,
   'bagReference',(select 'K-'||b.reference from public.bag_receipts b where b.tenant_id=p_tenant and b.id=h.received_bag_id)) order by h.created_at desc),'[]')
   from (select * from public.seller_handovers where tenant_id=p_tenant and seller_id=p_seller order by created_at desc limit 50) h));
end $$;

-- Staff queue: open handovers with the seller's name, newest first.
create function public.handover_queue(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'reference','H-'||h.reference,'sellerId',h.seller_id,'sellerName',s.name,'kind',h.kind,'estimatedItems',h.estimated_items,'note',h.note,'status',h.status,'createdAt',h.created_at,'receivedAt',h.received_at,'bagId',h.received_bag_id) order by h.status='open' desc,h.created_at desc),'[]')
  from (select * from public.seller_handovers where tenant_id=p_tenant order by created_at desc limit 100) h join public.sellers s on s.tenant_id=h.tenant_id and s.id=h.seller_id);
end $$;
revoke all on function public.create_my_handover(uuid,uuid,uuid,text,integer,text),public.cancel_my_handover(uuid,uuid,uuid),public.receive_handover(uuid,uuid,uuid,text,text),public.my_handovers(uuid,uuid),public.handover_queue(uuid) from public,anon;
grant execute on function public.create_my_handover(uuid,uuid,uuid,text,integer,text),public.cancel_my_handover(uuid,uuid,uuid),public.receive_handover(uuid,uuid,uuid,text,text),public.my_handovers(uuid,uuid),public.handover_queue(uuid) to authenticated;
