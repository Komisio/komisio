-- P2 S15: payouts as requested, approved, paid or rejected facts. The payout
-- row changes status only through the engine functions below, every
-- transition is a payout_events row, and the ledger holds the money: approval
-- reserves, payment releases and pays, rejection releases. Rail manual only.
create table public.payouts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 amount_ore bigint not null check(amount_ore>0 and amount_ore<=99999999999),
 currency text not null default 'SEK' check(currency='SEK'),
 status text not null default 'requested' check(status in ('requested','approved','paid','rejected')),
 rail text not null default 'manual' check(rail in ('manual')),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 paid_by uuid references auth.users(id),
 paid_at timestamptz,
 payment_reference text not null default '' check(length(payment_reference)<=200),
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 -- A rejected payout may keep its approval time: it was approved, then rejected.
 check(status not in ('approved','paid') or approved_at is not null),
 check(status<>'requested' or approved_at is null),
 check((status='paid')=(paid_at is not null)),
 check(status<>'paid' or length(trim(payment_reference))>0)
);
create index payouts_tenant on public.payouts(tenant_id,requested_at desc,id);
create index payouts_seller on public.payouts(tenant_id,seller_id,requested_at desc);
create table public.payout_events (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 payout_id uuid not null,
 kind text not null check(kind in ('requested','approved','paid','rejected')),
 reason text not null default '' check(length(reason)<=500),
 reference text not null default '' check(length(reference)<=200),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 foreign key(tenant_id,payout_id) references public.payouts(tenant_id,id)
);
create index payout_events_payout on public.payout_events(tenant_id,payout_id,occurred_at);
alter table public.payouts enable row level security;
alter table public.payout_events enable row level security;
create policy payouts_read on public.payouts for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create policy payout_events_read on public.payout_events for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.payouts,public.payout_events from public,anon,authenticated;
grant select on public.payouts,public.payout_events to authenticated;
-- Status moves only inside an engine transition; anything else, privileged or not, is refused.
create function komisio_private.guard_payout() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.payout_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_PAYOUT' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.seller_id<>old.seller_id or new.amount_ore<>old.amount_ore or new.requested_by<>old.requested_by or new.requested_at<>old.requested_at then raise exception 'IMMUTABLE_PAYOUT' using errcode='55000'; end if;
 return new;
end $$;
create function komisio_private.preserve_payout_event() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_PAYOUT' using errcode='55000'; end $$;
revoke all on function komisio_private.guard_payout(),komisio_private.preserve_payout_event() from public,anon,authenticated;
create trigger payouts_guard before update or delete on public.payouts for each row execute function komisio_private.guard_payout();
create trigger payout_events_immutable before update or delete on public.payout_events for each row execute function komisio_private.preserve_payout_event();

create function komisio_private.available_ore(p_tenant uuid,p_seller uuid) returns bigint
language sql stable set search_path='' as $$
 select coalesce(sum(amount_ore),0)::bigint from public.seller_ledger_entries where tenant_id=p_tenant and seller_id=p_seller;
$$;
revoke all on function komisio_private.available_ore(uuid,uuid) from public,anon,authenticated;

-- A request never moves money; it is bounded by the available balance and the policy threshold.
create function public.request_payout(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.payouts; threshold bigint; available bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_amount_ore is null or p_amount_ore<=0 or p_amount_ore>99999999999 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.payouts where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.amount_ore is distinct from p_amount_ore or prior.requested_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 threshold:=round(coalesce((public.current_store_policy(p_tenant)->'policy'->>'minPayoutThreshold')::numeric,0)*100)::bigint;
 if p_amount_ore<threshold then raise exception 'PAYOUT_BELOW_THRESHOLD'; end if;
 available:=komisio_private.available_ore(p_tenant,p_seller);
 if p_amount_ore>available then raise exception 'PAYOUT_EXCEEDS_BALANCE'; end if;
 insert into public.payouts(id,tenant_id,seller_id,amount_ore,requested_by) values(p_id,p_tenant,p_seller,p_amount_ore,uid);
 insert into public.payout_events(id,tenant_id,payout_id,kind,actor) values(p_id,p_tenant,p_id,'requested',uid);
 perform komisio_private.record_access(p_tenant,'payout.requested',p_id,jsonb_build_object('seller_id',p_seller,'amount_ore',p_amount_ore));
 return p_id;
end $$;

-- Shared transition body: replay by event id, status precondition, ledger movement, event.
create function komisio_private.transition_payout(p_tenant uuid,p_id uuid,p_payout uuid,p_kind text,p_reason text,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.payout_events; payout public.payouts; note text:=trim(coalesce(p_reason,'')); ref text:=trim(coalesce(p_reference,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_payout is null or length(note)>500 or length(ref)>200 or (p_kind='paid' and length(ref)=0) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.payout_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.payout_id is distinct from p_payout or prior.kind is distinct from p_kind or prior.actor is distinct from uid
   or prior.reason is distinct from note or prior.reference is distinct from ref then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into payout from public.payouts where tenant_id=p_tenant and id=p_payout;
 if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
 perform set_config('komisio.payout_transition','engine',true);
 case p_kind
 when 'approved' then
  if payout.status<>'requested' then raise exception 'PAYOUT_NOT_REQUESTED'; end if;
  if payout.amount_ore>komisio_private.available_ore(p_tenant,payout.seller_id) then raise exception 'PAYOUT_EXCEEDS_BALANCE'; end if;
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
  values(gen_random_uuid(),p_tenant,payout.seller_id,'payout_reserved',-payout.amount_ore,'payout',payout.id,now(),uid);
  update public.payouts set status='approved',approved_by=uid,approved_at=now() where id=payout.id;
 when 'paid' then
  if payout.status<>'approved' then raise exception 'PAYOUT_NOT_APPROVED'; end if;
  insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by) values
   (gen_random_uuid(),p_tenant,payout.seller_id,'payout_released',payout.amount_ore,'payout',payout.id,now(),uid),
   (gen_random_uuid(),p_tenant,payout.seller_id,'payout_paid',-payout.amount_ore,'payout',payout.id,now(),uid);
  update public.payouts set status='paid',paid_by=uid,paid_at=now(),payment_reference=ref where id=payout.id;
 when 'rejected' then
  if payout.status not in ('requested','approved') then raise exception 'PAYOUT_DECIDED'; end if;
  if payout.status='approved' then
   insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,reason,occurred_at,recorded_by)
   values(gen_random_uuid(),p_tenant,payout.seller_id,'payout_released',payout.amount_ore,'payout',payout.id,note,now(),uid);
  end if;
  update public.payouts set status='rejected' where id=payout.id;
 else raise exception 'INVALID_INPUT';
 end case;
 perform set_config('komisio.payout_transition','',true);
 insert into public.payout_events(id,tenant_id,payout_id,kind,reason,reference,actor) values(p_id,p_tenant,payout.id,p_kind,note,ref,uid);
 perform komisio_private.record_access(p_tenant,'payout.'||p_kind,payout.id,jsonb_build_object('amount_ore',payout.amount_ore,'seller_id',payout.seller_id));
 return p_id;
end $$;
revoke all on function komisio_private.transition_payout(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;

create function public.approve_payout(p_tenant uuid,p_id uuid,p_payout uuid,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$ begin return komisio_private.transition_payout(p_tenant,p_id,p_payout,'approved',p_reason,''); end $$;
create function public.mark_payout_paid(p_tenant uuid,p_id uuid,p_payout uuid,p_reference text,p_reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$ begin return komisio_private.transition_payout(p_tenant,p_id,p_payout,'paid',p_reason,p_reference); end $$;
create function public.reject_payout(p_tenant uuid,p_id uuid,p_payout uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$ begin return komisio_private.transition_payout(p_tenant,p_id,p_payout,'rejected',p_reason,''); end $$;
revoke all on function public.request_payout(uuid,uuid,uuid,bigint),public.approve_payout(uuid,uuid,uuid,text),public.mark_payout_paid(uuid,uuid,uuid,text,text),public.reject_payout(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.request_payout(uuid,uuid,uuid,bigint),public.approve_payout(uuid,uuid,uuid,text),public.mark_payout_paid(uuid,uuid,uuid,text,text),public.reject_payout(uuid,uuid,uuid,text) to authenticated;
