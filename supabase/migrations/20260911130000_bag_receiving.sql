-- Minimal custody records. No sale, pricing or agreement acceptance is implied.
create table public.sellers (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 name text not null check(length(trim(name)) between 1 and 120),
 email text not null default '' check(length(email)<=254),
 phone text not null default '' check(length(phone)<=40),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 check(email<>'' or phone<>''),
 check(email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
create index sellers_tenant_name on public.sellers(tenant_id,name,id);
create table public.bag_receipts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 reference bigint generated always as identity unique,
 note text not null default '' check(length(note)<=500),
 created_by uuid not null references auth.users(id),
 received_at timestamptz not null default now(),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
create index bag_receipts_queue on public.bag_receipts(tenant_id,received_at desc,id);
alter table public.sellers enable row level security;
alter table public.bag_receipts enable row level security;
create policy seller_read on public.sellers for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
create policy bag_read on public.bag_receipts for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.sellers,public.bag_receipts from public,anon,authenticated;
grant select on public.sellers,public.bag_receipts to authenticated;
revoke all on sequence public.bag_receipts_reference_seq from public,anon,authenticated;

create function public.register_seller(p_tenant uuid,p_id uuid,p_name text,p_email text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.sellers;
 n text:=trim(p_name); e text:=lower(trim(p_email)); ph text:=trim(p_phone);
begin
 -- Serialize with membership changes so a removed actor cannot finish a new write.
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then
  raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or n is null or length(n) not between 1 and 120
 or e is null or ph is null or length(e)>254 or length(ph)>40 or (e='' and ph='')
 or (e<>'' and e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
  raise exception 'INVALID_INPUT'; end if;
 insert into public.sellers(id,tenant_id,name,email,phone,created_by)
 values(p_id,p_tenant,n,e,ph,uid) on conflict(id) do nothing;
 if found then
  perform komisio_private.record_access(p_tenant,'seller.registered',p_id,'{}'::jsonb);
 else
  select * into previous from public.sellers where id=p_id;
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.name is distinct from n or previous.email is distinct from e or previous.phone is distinct from ph then
   raise exception 'REQUEST_CONFLICT'; end if;
 end if;
 return p_id;
end $$;

create function public.receive_bag(p_tenant uuid,p_id uuid,p_seller uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.bag_receipts; n text:=trim(p_note);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then
  raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or n is null or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where id=p_seller and tenant_id=p_tenant) then
  raise exception 'SELLER_NOT_FOUND'; end if;
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by)
 values(p_id,p_tenant,p_seller,n,uid) on conflict(id) do nothing;
 if found then
  perform komisio_private.record_access(p_tenant,'bag.received',p_id,'{}'::jsonb);
 else
  select * into previous from public.bag_receipts where id=p_id;
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.seller_id is distinct from p_seller or previous.note is distinct from n then
   raise exception 'REQUEST_CONFLICT'; end if;
 end if;
 return p_id;
end $$;
revoke all on function public.register_seller(uuid,uuid,text,text,text),public.receive_bag(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.register_seller(uuid,uuid,text,text,text),public.receive_bag(uuid,uuid,uuid,text) to authenticated;
