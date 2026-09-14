-- P3 Fortnox voucher sending: one recorded export becomes at most one voucher
-- in the connected Fortnox company. A send is a row that starts pending and
-- ends sent or failed; a failed send may be followed by a new row, a sent one
-- may not (the voucher exists in Fortnox). The row records the company
-- database the send was bound to; the application refuses to send when the
-- company answering at send time is another database. Nothing here contacts
-- Fortnox: the application does, between begin and complete.
create table public.fortnox_voucher_sends (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 export_id uuid not null references public.accounting_exports(id),
 database_number text not null check(length(database_number) between 1 and 40),
 status text not null check(status in ('pending','sent','failed')),
 voucher_series text not null default '' check(length(voucher_series)<=10),
 voucher_number integer check(voucher_number is null or voucher_number>0),
 financial_year integer check(financial_year is null or financial_year>0),
 error_code text not null default '' check(length(error_code)<=80),
 detail text not null default '' check(length(detail)<=500),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check((status='pending')=(completed_at is null))
);
create index fortnox_voucher_sends_tenant on public.fortnox_voucher_sends(tenant_id,created_at desc);
create unique index fortnox_voucher_sends_once on public.fortnox_voucher_sends(tenant_id,export_id) where status in ('pending','sent');
alter table public.fortnox_voucher_sends enable row level security;
revoke all on public.fortnox_voucher_sends from public,anon,authenticated;
grant select on public.fortnox_voucher_sends to authenticated;
create policy fortnox_voucher_sends_read on public.fortnox_voucher_sends for select to authenticated using(tenant_id in(select public.user_tenant_ids()));

create function komisio_private.guard_fortnox_send() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
 if current_setting('komisio.fortnox_transition',true) is distinct from 'engine' or old.status<>'pending' or new.status='pending'
  or new.id<>old.id or new.tenant_id<>old.tenant_id or new.export_id<>old.export_id or new.database_number<>old.database_number or new.actor<>old.actor or new.created_at<>old.created_at
 then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_fortnox_send() from public,anon,authenticated;
create trigger fortnox_voucher_sends_guard before update or delete on public.fortnox_voucher_sends for each row execute function komisio_private.guard_fortnox_send();

-- Opens a send for one export. Replay by id returns the row's state; a
-- second request while one is pending is refused for ten minutes, after
-- which the stale row is closed as failed and a new one may start.
create function public.begin_fortnox_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections; e public.accounting_exports; close public.day_closes; prior public.fortnox_voucher_sends; open_row public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior);
 end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'FORTNOX_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 select * into open_row from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'FORTNOX_ALREADY_SENT'; end if;
  if open_row.created_at>now()-interval '10 minutes' then raise exception 'FORTNOX_SEND_IN_PROGRESS'; end if;
  perform set_config('komisio.fortnox_transition','engine',true);
  update public.fortnox_voucher_sends set status='failed',error_code='STALE',completed_at=now() where id=open_row.id;
  perform set_config('komisio.fortnox_transition','',true);
 end if;
 insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,'pending',uid);
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 return komisio_private.fortnox_send_state(prior);
end $$;

create function komisio_private.fortnox_send_state(s public.fortnox_voucher_sends) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',s.id,'exportId',s.export_id,'status',s.status,'databaseNumber',s.database_number,'voucherSeries',s.voucher_series,'voucherNumber',s.voucher_number,'financialYear',s.financial_year,'errorCode',s.error_code,'detail',s.detail,
  'closeDate',d.close_date,'closeVersion',d.version,'lines',e.voucher,'debitOre',e.debit_ore,'creditOre',e.credit_ore)
 from public.accounting_exports e join public.day_closes d on d.tenant_id=e.tenant_id and d.id=e.day_close_id where e.id=s.export_id;
$$;
revoke all on function komisio_private.fortnox_send_state(public.fortnox_voucher_sends) from public,anon,authenticated;

-- Closes a pending send. Repeating the same outcome is a no-op; another outcome is refused.
create function public.complete_fortnox_send(p_tenant uuid,p_id uuid,p_status text,p_series text,p_number integer,p_year integer,p_error text,p_detail text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status not in ('sent','failed') or (p_status='sent' and (p_number is null or p_series is null or length(p_series)=0)) or (p_status='failed' and (p_error is null or length(p_error)=0)) then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.fortnox_voucher_sends where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if s.status<>'pending' then
  if s.status=p_status then return komisio_private.fortnox_send_state(s); end if;
  raise exception 'SEND_NOT_PENDING';
 end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 update public.fortnox_voucher_sends set status=p_status,voucher_series=coalesce(left(p_series,10),''),voucher_number=case when p_status='sent' then p_number end,financial_year=case when p_status='sent' then p_year end,
  error_code=case when p_status='failed' then left(p_error,80) else '' end,detail=coalesce(left(p_detail,500),''),completed_at=now() where id=s.id returning * into s;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.record_access(p_tenant,'fortnox.voucher_'||p_status,s.export_id,jsonb_build_object('send_id',s.id,'voucher_series',s.voucher_series,'voucher_number',s.voucher_number,'error_code',s.error_code));
 return komisio_private.fortnox_send_state(s);
end $$;
revoke all on function public.begin_fortnox_send(uuid,uuid,uuid),public.complete_fortnox_send(uuid,uuid,text,text,integer,integer,text,text) from public,anon;
grant execute on function public.begin_fortnox_send(uuid,uuid,uuid),public.complete_fortnox_send(uuid,uuid,text,text,integer,integer,text,text) to authenticated;
