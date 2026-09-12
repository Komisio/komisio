-- P1 S3: custody of a single garment received at the counter or wall.
-- A reception session proves nothing physical; this receipt does, once per
-- session, attested by staff. Not acceptance, not sale eligibility, not consent.
create table public.garment_receipts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 session_id uuid not null unique,
 reference bigint generated always as identity unique,
 note text not null default '' check(length(note)<=500),
 custody_source text not null default 'staff_receipt' check(custody_source in ('staff_receipt')),
 created_by uuid not null references auth.users(id),
 received_at timestamptz not null default now(),
 unique(tenant_id,id),
 foreign key(tenant_id,session_id) references public.reception_sessions(tenant_id,id)
);
create index garment_receipts_queue on public.garment_receipts(tenant_id,received_at desc,id);
alter table public.garment_receipts enable row level security;
create policy garment_receipt_read on public.garment_receipts for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.garment_receipts from public,anon,authenticated;
grant select on public.garment_receipts to authenticated;
revoke all on sequence public.garment_receipts_reference_seq from public,anon,authenticated;
create trigger garment_receipts_immutable before update or delete on public.garment_receipts
 for each row execute function komisio_private.preserve_reception();

create function public.receive_garment(p_tenant uuid,p_id uuid,p_session uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.garment_receipts; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_session is null or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.garment_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.session_id is distinct from p_session
   or previous.created_by is distinct from uid or previous.note is distinct from n then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.reception_sessions where id=p_session and tenant_id=p_tenant) then raise exception 'RECEPTION_NOT_FOUND'; end if;
 if exists(select 1 from public.garment_receipts where session_id=p_session) then raise exception 'GARMENT_ALREADY_RECEIVED'; end if;
 insert into public.garment_receipts(id,tenant_id,session_id,note,created_by) values(p_id,p_tenant,p_session,n,uid);
 perform komisio_private.record_access(p_tenant,'garment.received',p_id,jsonb_build_object('session_id',p_session));
 return p_id;
end $$;
revoke all on function public.receive_garment(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.receive_garment(uuid,uuid,uuid,text) to authenticated;
