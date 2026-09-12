-- P1 S5: store-owned goods enter through a purchase registration without a
-- seller. Margin-scheme eligibility is attested here, at the purchase, by the
-- staff member who records it; acceptance (S4) copies it and never re-derives it.
create table public.purchase_receipts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 reference bigint generated always as identity unique,
 supplier_note text not null default '' check(length(supplier_note)<=500),
 purchase_price_ore bigint not null check(purchase_price_ore>=0 and purchase_price_ore<=99999999999),
 currency text not null default 'SEK' check(currency='SEK'),
 evidence_reference text not null check(length(trim(evidence_reference)) between 1 and 500),
 margin_eligible boolean not null,
 provider text not null default 'manual' check(provider in ('manual')),
 created_by uuid not null references auth.users(id),
 purchased_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create index purchase_receipts_queue on public.purchase_receipts(tenant_id,purchased_at desc,id);
alter table public.purchase_receipts enable row level security;
create policy purchase_receipt_read on public.purchase_receipts for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.purchase_receipts from public,anon,authenticated;
grant select on public.purchase_receipts to authenticated;
revoke all on sequence public.purchase_receipts_reference_seq from public,anon,authenticated;
create trigger purchase_receipts_immutable before update or delete on public.purchase_receipts
 for each row execute function komisio_private.preserve_reception();

create function public.register_purchase(p_tenant uuid,p_id uuid,p_note text,p_price_ore bigint,p_evidence text,p_margin_eligible boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.purchase_receipts; n text:=trim(coalesce(p_note,'')); e text:=trim(coalesce(p_evidence,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_price_ore is null or p_price_ore<0 or p_price_ore>99999999999 or length(n)>500
  or length(e) not between 1 and 500 or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.purchase_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid or previous.supplier_note is distinct from n
   or previous.purchase_price_ore is distinct from p_price_ore or previous.evidence_reference is distinct from e
   or previous.margin_eligible is distinct from p_margin_eligible then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 insert into public.purchase_receipts(id,tenant_id,supplier_note,purchase_price_ore,evidence_reference,margin_eligible,created_by)
 values(p_id,p_tenant,n,p_price_ore,e,p_margin_eligible,uid);
 perform komisio_private.record_access(p_tenant,'purchase.registered',p_id,jsonb_build_object('price_ore',p_price_ore,'margin_eligible',p_margin_eligible));
 return p_id;
end $$;
revoke all on function public.register_purchase(uuid,uuid,text,bigint,text,boolean) from public,anon;
grant execute on function public.register_purchase(uuid,uuid,text,bigint,text,boolean) to authenticated;
