-- P2 S18: the communication log. Every message to a seller is a row with the
-- exact subject and body as sent, the template that produced it, the fact it
-- refers to, and the delivery outcome. Queued by a person (or a staged agent
-- proposal later), sent by the application transport, outcome recorded once.
-- Nothing is edited except the single delivery transition.
create table public.seller_communications (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 kind text not null check(kind in ('item_accepted','item_sold','payout_approved','payout_paid','statement_issued','message')),
 channel text not null default 'email' check(channel in ('email')),
 template_key text not null check(length(template_key) between 1 and 100),
 template_version text not null check(length(template_version) between 1 and 40),
 locale text not null check(locale in ('sv','en')),
 recipient text not null check(length(recipient) between 3 and 254),
 subject text not null check(length(subject) between 1 and 200),
 body text not null check(length(body) between 1 and 8000),
 reference_kind text not null check(reference_kind in ('item','sale_line','payout','statement','none')),
 reference_id uuid,
 status text not null default 'queued' check(status in ('queued','sent','restricted','manual','unconfirmed','failed')),
 provider_message_id text not null default '' check(length(provider_message_id)<=200),
 queued_by uuid not null references auth.users(id),
 queued_at timestamptz not null default now(),
 delivered_at timestamptz,
 unique(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 check((reference_kind='none')=(reference_id is null)),
 check((status='queued')=(delivered_at is null))
);
create index seller_communications_seller on public.seller_communications(tenant_id,seller_id,queued_at desc);
alter table public.seller_communications enable row level security;
create policy seller_communications_read on public.seller_communications for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.seller_communications from public,anon,authenticated;
grant select on public.seller_communications to authenticated;
create function komisio_private.guard_communication() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or current_setting('komisio.communication_delivery',true) is distinct from 'engine' then raise exception 'IMMUTABLE_COMMUNICATION' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.seller_id<>old.seller_id or new.subject<>old.subject or new.body<>old.body or new.recipient<>old.recipient
  or new.kind<>old.kind or new.template_key<>old.template_key or new.template_version<>old.template_version or new.queued_by<>old.queued_by then raise exception 'IMMUTABLE_COMMUNICATION' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_communication() from public,anon,authenticated;
create trigger seller_communications_guard before update or delete on public.seller_communications for each row execute function komisio_private.guard_communication();

-- Queue one rendered message. The application renders from a versioned template; SQL binds it to the seller and the fact.
create function public.queue_seller_communication(p_tenant uuid,p_id uuid,p_seller uuid,p_kind text,p_template_key text,p_template_version text,p_locale text,p_subject text,p_body text,p_reference_kind text,p_reference_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_communications; seller public.sellers; ok boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_kind is null or p_kind not in ('item_accepted','item_sold','payout_approved','payout_paid','statement_issued','message')
  or p_locale not in ('sv','en') or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 8000
  or p_template_key is null or length(p_template_key) not between 1 and 100 or p_template_version is null or length(p_template_version) not between 1 and 40
  or p_reference_kind not in ('item','sale_line','payout','statement','none') or ((p_reference_kind='none')<>(p_reference_id is null)) then raise exception 'INVALID_INPUT'; end if;
 select * into seller from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 if seller.email='' then raise exception 'SELLER_EMAIL_MISSING'; end if;
 select * into prior from public.seller_communications where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind is distinct from p_kind or prior.subject is distinct from trim(p_subject)
   or prior.body is distinct from trim(p_body) or prior.reference_id is distinct from p_reference_id or prior.queued_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 -- The referenced fact must exist for this tenant and belong to this seller where the fact knows its seller.
 ok:=case p_reference_kind
  when 'none' then true
  when 'item' then exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=p_reference_id and i.seller_id=p_seller)
  when 'sale_line' then exists(select 1 from public.sale_lines l join public.items i on i.tenant_id=l.tenant_id and i.id=l.item_id where l.tenant_id=p_tenant and l.id=p_reference_id and i.seller_id=p_seller)
  when 'payout' then exists(select 1 from public.payouts p where p.tenant_id=p_tenant and p.id=p_reference_id and p.seller_id=p_seller)
  when 'statement' then exists(select 1 from public.settlement_statements s where s.tenant_id=p_tenant and s.id=p_reference_id and s.seller_id=p_seller)
  end;
 if not ok then raise exception 'REFERENCE_NOT_FOUND'; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by)
 values(p_id,p_tenant,p_seller,p_kind,p_template_key,p_template_version,p_locale,lower(seller.email),trim(p_subject),trim(p_body),p_reference_kind,p_reference_id,uid);
 perform komisio_private.record_access(p_tenant,'communication.queued',p_id,jsonb_build_object('seller_id',p_seller,'kind',p_kind,'reference_kind',p_reference_kind));
 return p_id;
end $$;

-- The one allowed transition: queued to a delivery outcome, once.
create function public.record_communication_delivery(p_tenant uuid,p_id uuid,p_status text,p_provider_message_id text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); row public.seller_communications; pid text:=coalesce(trim(p_provider_message_id),'');
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_status not in ('sent','restricted','manual','unconfirmed','failed') or length(pid)>200 then raise exception 'INVALID_INPUT'; end if;
 select * into row from public.seller_communications where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'COMMUNICATION_NOT_FOUND'; end if;
 if row.status<>'queued' then
  if row.status=p_status and row.provider_message_id=pid then return p_id; end if;
  raise exception 'COMMUNICATION_DECIDED';
 end if;
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set status=p_status,provider_message_id=pid,delivered_at=now() where id=p_id;
 perform set_config('komisio.communication_delivery','',true);
 perform komisio_private.record_access(p_tenant,'communication.'||p_status,p_id,jsonb_build_object('seller_id',row.seller_id,'kind',row.kind));
 return p_id;
end $$;
revoke all on function public.queue_seller_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid),public.record_communication_delivery(uuid,uuid,text,text) from public,anon;
grant execute on function public.queue_seller_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid),public.record_communication_delivery(uuid,uuid,text,text) to authenticated;
