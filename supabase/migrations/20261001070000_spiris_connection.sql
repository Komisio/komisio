-- Spiris (formerly Visma eEkonomi / eAccounting) connection and voucher sending: the second
-- accounting target next to Fortnox, built to the same contract. One
-- connected Spiris company per store, tokens stored as ciphertext the
-- application seals with a server-side key the database never sees. The
-- connection is bound to the company key (corporate identity number, or the
-- normalised name when Spiris reports none) and the company name, so a token
-- for another company is refused before it is stored. The company currency is
-- recorded so a store can only send to a company kept in its own currency.
-- Owner or admin connects, checks and disconnects; every step is an
-- append-only event. One recorded export becomes at most one voucher; a send
-- starts pending and ends sent or failed, a sent one is never resent, and an
-- uncertain outcome is held until the owner confirms the voucher in Spiris.
create sequence komisio_private.spiris_connection_revision as bigint no cycle;
revoke all on sequence komisio_private.spiris_connection_revision from public,anon,authenticated;

create table public.spiris_connections (
 tenant_id uuid primary key references public.tenants(id),
 company_key text not null check(length(company_key) between 1 and 80),
 company_name text not null check(length(company_name) between 1 and 200),
 organisation_number text not null default '' check(length(organisation_number)<=40),
 currency_code text not null check(currency_code ~ '^[A-Z]{3}$'),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 scope text not null default '' check(length(scope)<=500),
 expires_at timestamptz not null,
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now(),
 refreshed_at timestamptz not null default now(),
 revision bigint not null default nextval('komisio_private.spiris_connection_revision')
);
create table public.spiris_connection_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('connected','refreshed','checked','refused','disconnected')),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index spiris_connection_events_tenant on public.spiris_connection_events(tenant_id,occurred_at desc);
alter table public.spiris_connections enable row level security;
alter table public.spiris_connection_events enable row level security;
revoke all on public.spiris_connections,public.spiris_connection_events from public,anon,authenticated;
-- The ciphertext row is never selectable directly (no grant); the policy states who could ever read it.
grant select on public.spiris_connection_events to authenticated;
create policy spiris_connections_owner on public.spiris_connections for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy spiris_events_read on public.spiris_connection_events for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger spiris_connection_events_immutable before update or delete on public.spiris_connection_events for each row execute function komisio_private.preserve_payout_event();

create function komisio_private.guard_spiris_connection() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.spiris_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_CONNECTION' using errcode='55000'; end if;
 if tg_op='DELETE' then return old; end if;
 new.revision:=nextval('komisio_private.spiris_connection_revision');
 return new;
end $$;
revoke all on function komisio_private.guard_spiris_connection() from public,anon,authenticated;
create trigger spiris_connections_guard before update or delete on public.spiris_connections for each row execute function komisio_private.guard_spiris_connection();

create function komisio_private.spiris_event(p_tenant uuid,p_kind text,p_detail jsonb,p_actor uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.spiris_connection_events(tenant_id,kind,detail,actor) values(p_tenant,p_kind,coalesce(p_detail,'{}'::jsonb),p_actor);
$$;
revoke all on function komisio_private.spiris_event(uuid,text,jsonb,uuid) from public,anon,authenticated;

-- Store or replace the store's connection after the application verified the company.
create function public.store_spiris_connection(p_tenant uuid,p_company_key text,p_company_name text,p_organisation_number text,p_currency_code text,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.spiris_connections; replacing boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_company_key is null or length(trim(p_company_key)) not between 1 and 80 or p_company_name is null or length(trim(p_company_name)) not between 1 and 200
  or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$'
  or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.spiris_connections where tenant_id=p_tenant;
 replacing:=found;
 if replacing and existing.company_key<>trim(p_company_key) then raise exception 'SPIRIS_WRONG_COMPANY'; end if;
 perform set_config('komisio.spiris_transition','engine',true);
 if replacing then
  update public.spiris_connections set company_name=trim(p_company_name),organisation_number=coalesce(trim(p_organisation_number),''),currency_code=p_currency_code,cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=now() where tenant_id=p_tenant;
 else
  insert into public.spiris_connections(tenant_id,company_key,company_name,organisation_number,currency_code,cipher,scope,expires_at,connected_by)
  values(p_tenant,trim(p_company_key),trim(p_company_name),coalesce(trim(p_organisation_number),''),p_currency_code,p_cipher,coalesce(p_scope,''),p_expires_at,uid);
 end if;
 perform set_config('komisio.spiris_transition','',true);
 perform komisio_private.spiris_event(p_tenant,case when replacing then 'refreshed' else 'connected' end,jsonb_build_object('company_key',trim(p_company_key),'company_name',trim(p_company_name),'currency_code',p_currency_code),uid);
 perform komisio_private.record_access(p_tenant,'spiris.'||case when replacing then 'refreshed' else 'connected' end,p_tenant,jsonb_build_object('company_key',trim(p_company_key)));
 return jsonb_build_object('companyKey',trim(p_company_key),'companyName',trim(p_company_name),'currencyCode',p_currency_code,'replaced',replacing);
end $$;

-- The server reads the ciphertext to act for the store; owner or admin only.
create function public.read_spiris_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.spiris_connections;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.spiris_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('companyKey',c.company_key,'companyName',c.company_name,'organisationNumber',c.organisation_number,'currencyCode',c.currency_code,'cipher',c.cipher,'scope',c.scope,'expiresAt',c.expires_at,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,'revision',c.revision::text);
end $$;

-- Revision-bound renewal: the caller names the revision it read; a stale one
-- is refused as data so both the refusal and its event stay committed.
create function public.refresh_spiris_tokens(p_tenant uuid,p_revision bigint,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.spiris_connections; detail jsonb; next_revision bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_revision is null or p_revision<1 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data'])
  or length(coalesce(p_scope,''))>500 or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into connection from public.spiris_connections where tenant_id=p_tenant;
 if not found then raise exception 'SPIRIS_NOT_CONNECTED'; end if;
 if connection.revision<>p_revision then
  detail:=jsonb_build_object('reason','SPIRIS_CONNECTION_CHANGED','expected_revision',p_revision::text,'current_revision',connection.revision::text);
  perform komisio_private.spiris_event(p_tenant,'refused',detail,actor);
  perform komisio_private.record_access(p_tenant,'spiris.refused',p_tenant,detail);
  return jsonb_build_object('error','SPIRIS_CONNECTION_CHANGED');
 end if;
 perform set_config('komisio.spiris_transition','engine',true);
 update public.spiris_connections set cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=clock_timestamp()
  where tenant_id=p_tenant returning revision into next_revision;
 perform set_config('komisio.spiris_transition','',true);
 detail:=jsonb_build_object('company_key',connection.company_key,'previous_revision',p_revision::text,'revision',next_revision::text);
 perform komisio_private.spiris_event(p_tenant,'refreshed',detail,actor);
 perform komisio_private.record_access(p_tenant,'spiris.refreshed',p_tenant,detail);
 return jsonb_build_object('status','refreshed','revision',next_revision::text);
end $$;

-- What any member may see: whether and to which company the store is connected, never the tokens.
create function public.spiris_connection_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.spiris_connections;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.spiris_connections where tenant_id=p_tenant;
 return jsonb_build_object('connected',found,'companyKey',c.company_key,'companyName',c.company_name,'organisationNumber',c.organisation_number,'currencyCode',c.currency_code,'scope',c.scope,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'detail',e.detail,'occurredAt',e.occurred_at) order by e.occurred_at desc),'[]') from (select * from public.spiris_connection_events where tenant_id=p_tenant order by occurred_at desc limit 20) e));
end $$;

create function public.record_spiris_check(p_tenant uuid,p_kind text,p_detail jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('checked','refused') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.spiris_event(p_tenant,p_kind,p_detail,uid);
end $$;

create function public.disconnect_spiris(p_tenant uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.spiris_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.spiris_connections where tenant_id=p_tenant;
 if not found then return false; end if;
 perform set_config('komisio.spiris_transition','engine',true);
 delete from public.spiris_connections where tenant_id=p_tenant;
 perform set_config('komisio.spiris_transition','',true);
 perform komisio_private.spiris_event(p_tenant,'disconnected',jsonb_build_object('company_key',c.company_key),uid);
 perform komisio_private.record_access(p_tenant,'spiris.disconnected',p_tenant,jsonb_build_object('company_key',c.company_key));
 return true;
end $$;
revoke all on function public.store_spiris_connection(uuid,text,text,text,text,jsonb,text,timestamptz),public.read_spiris_connection(uuid),public.refresh_spiris_tokens(uuid,bigint,jsonb,text,timestamptz),public.spiris_connection_status(uuid),public.record_spiris_check(uuid,text,jsonb),public.disconnect_spiris(uuid) from public,anon;
grant execute on function public.store_spiris_connection(uuid,text,text,text,text,jsonb,text,timestamptz),public.read_spiris_connection(uuid),public.refresh_spiris_tokens(uuid,bigint,jsonb,text,timestamptz),public.spiris_connection_status(uuid),public.record_spiris_check(uuid,text,jsonb),public.disconnect_spiris(uuid) to authenticated;

-- Voucher sends. Spiris identifies a voucher by an id and a number within a
-- number series ("A12"); both are recorded as text.
create table public.spiris_voucher_sends (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 export_id uuid not null references public.accounting_exports(id),
 company_key text not null check(length(company_key) between 1 and 80),
 status text not null check(status in ('pending','sent','failed')),
 voucher_id text not null default '' check(length(voucher_id)<=80),
 voucher_number text not null default '' check(length(voucher_number)<=40),
 error_code text not null default '' check(length(error_code)<=80),
 detail text not null default '' check(length(detail)<=500),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 reconciled_by uuid references auth.users(id),
 reconciled_at timestamptz,
 reconciliation_evidence text not null default '' check(length(reconciliation_evidence)<=500),
 check((status='pending')=(completed_at is null)),
 check((status='sent')=(voucher_number<>'')),
 constraint spiris_reconciliation_complete check(
  (reconciled_by is null and reconciled_at is null and reconciliation_evidence='') or
  (reconciled_by is not null and reconciled_at is not null and length(trim(reconciliation_evidence))>0 and status='sent'))
);
create index spiris_voucher_sends_tenant on public.spiris_voucher_sends(tenant_id,created_at desc);
create unique index spiris_voucher_sends_once on public.spiris_voucher_sends(tenant_id,export_id) where status in ('pending','sent');
alter table public.spiris_voucher_sends enable row level security;
revoke all on public.spiris_voucher_sends from public,anon,authenticated;
grant select on public.spiris_voucher_sends to authenticated;
create policy spiris_voucher_sends_read on public.spiris_voucher_sends for select to authenticated using(tenant_id in(select public.user_tenant_ids()));

create function komisio_private.guard_spiris_send() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.export_id<>old.export_id or new.company_key<>old.company_key or new.actor<>old.actor or new.created_at<>old.created_at then
  raise exception 'IMMUTABLE_SEND' using errcode='55000';
 end if;
 if current_setting('komisio.spiris_transition',true)='reconcile_sent' then
  if old.reconciled_by is not null or not(old.status='pending' or (old.status='failed' and old.error_code='SPIRIS_OUTCOME_UNKNOWN'))
   or new.status<>'sent' or new.reconciled_by is null or new.reconciled_at is null then
   raise exception 'IMMUTABLE_SEND' using errcode='55000';
  end if;
 else
  if current_setting('komisio.spiris_transition',true) is distinct from 'engine' or old.status<>'pending' or new.status='pending'
   or new.reconciled_by is distinct from old.reconciled_by or new.reconciled_at is distinct from old.reconciled_at
   or new.reconciliation_evidence is distinct from old.reconciliation_evidence then
   raise exception 'IMMUTABLE_SEND' using errcode='55000';
  end if;
 end if;
 return new;
end $$;
revoke all on function komisio_private.guard_spiris_send() from public,anon,authenticated;
create trigger spiris_voucher_sends_guard before update or delete on public.spiris_voucher_sends for each row execute function komisio_private.guard_spiris_send();

create function komisio_private.spiris_send_state(s public.spiris_voucher_sends) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',s.id,'exportId',s.export_id,'status',s.status,'companyKey',s.company_key,'voucherId',s.voucher_id,'voucherNumber',s.voucher_number,'errorCode',s.error_code,'detail',s.detail,
  'closeDate',d.close_date,'closeVersion',d.version,'lines',e.voucher,'debitOre',e.debit_ore,'creditOre',e.credit_ore)
 from public.accounting_exports e join public.day_closes d on d.tenant_id=e.tenant_id and d.id=e.day_close_id where e.id=s.export_id;
$$;
revoke all on function komisio_private.spiris_send_state(public.spiris_voucher_sends) from public,anon,authenticated;

-- Opens a send for one export. Replay by id returns the row's state without
-- permission to dispatch; a pending or uncertain earlier send holds the export.
create function public.begin_spiris_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.spiris_connections; e public.accounting_exports; prior public.spiris_voucher_sends; open_row public.spiris_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.spiris_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.spiris_send_state(prior)||jsonb_build_object('dispatchAllowed',false);
 end if;
 select * into c from public.spiris_connections where tenant_id=p_tenant;
 if not found then raise exception 'SPIRIS_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>c.currency_code then raise exception 'SPIRIS_CURRENCY_MISMATCH'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 select * into open_row from public.spiris_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'SPIRIS_ALREADY_SENT'; end if;
  raise exception 'SPIRIS_SEND_IN_PROGRESS';
 end if;
 if exists(select 1 from public.spiris_voucher_sends where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code not in ('SPIRIS_PREFLIGHT_FAILED','SPIRIS_WRONG_COMPANY')) then raise exception 'SPIRIS_OUTCOME_UNKNOWN'; end if;
 insert into public.spiris_voucher_sends(id,tenant_id,export_id,company_key,status,actor) values(p_id,p_tenant,p_export,c.company_key,'pending',uid);
 select * into prior from public.spiris_voucher_sends where id=p_id;
 return komisio_private.spiris_send_state(prior)||jsonb_build_object('dispatchAllowed',true);
end $$;

-- Closes a pending send. Repeating the same outcome is a no-op; another outcome is refused.
create function public.complete_spiris_send(p_tenant uuid,p_id uuid,p_status text,p_voucher_id text,p_voucher_number text,p_error text,p_detail text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.spiris_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status not in ('sent','failed') or (p_status='sent' and length(trim(coalesce(p_voucher_number,''))) not between 1 and 40) or (p_status='failed' and (p_error is null or length(p_error)=0)) then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.spiris_voucher_sends where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if s.status<>'pending' then
  if s.status=p_status then return komisio_private.spiris_send_state(s); end if;
  raise exception 'SEND_NOT_PENDING';
 end if;
 perform set_config('komisio.spiris_transition','engine',true);
 update public.spiris_voucher_sends set status=p_status,voucher_id=case when p_status='sent' then left(trim(coalesce(p_voucher_id,'')),80) else '' end,voucher_number=case when p_status='sent' then trim(p_voucher_number) else '' end,
  error_code=case when p_status='failed' then left(p_error,80) else '' end,detail=coalesce(left(p_detail,500),''),completed_at=now() where id=s.id returning * into s;
 perform set_config('komisio.spiris_transition','',true);
 perform komisio_private.record_access(p_tenant,'spiris.voucher_'||p_status,s.export_id,jsonb_build_object('send_id',s.id,'voucher_id',s.voucher_id,'voucher_number',s.voucher_number,'error_code',s.error_code));
 return komisio_private.spiris_send_state(s);
end $$;

-- The owner confirms that a held send's voucher exists in Spiris, with evidence. Absence cannot be confirmed here.
create function public.reconcile_spiris_send(p_tenant uuid,p_send_id uuid,p_outcome text,p_voucher_id text,p_voucher_number text,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.spiris_voucher_sends; result public.spiris_voucher_sends;
 number text:=trim(coalesce(p_voucher_number,'')); voucher text:=trim(coalesce(p_voucher_id,'')); evidence text:=trim(coalesce(p_evidence,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_send_id is null or p_outcome is distinct from 'confirmed_sent' or length(number) not between 1 and 40 or length(voucher)>80
  or length(evidence) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.spiris_voucher_sends where tenant_id=p_tenant and id=p_send_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if prior.reconciled_by is not null then
  if prior.reconciled_by<>uid or prior.voucher_number<>number or prior.voucher_id<>voucher or prior.reconciliation_evidence<>evidence then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.spiris_send_state(prior);
 end if;
 if not(prior.status='pending' or (prior.status='failed' and prior.error_code='SPIRIS_OUTCOME_UNKNOWN')) then raise exception 'SEND_NOT_PENDING'; end if;
 perform set_config('komisio.spiris_transition','reconcile_sent',true);
 update public.spiris_voucher_sends set status='sent',voucher_id=voucher,voucher_number=number,error_code='',detail='',
  completed_at=now(),reconciled_by=uid,reconciled_at=now(),reconciliation_evidence=evidence
 where id=prior.id returning * into result;
 perform set_config('komisio.spiris_transition','',true);
 perform komisio_private.record_access(p_tenant,'spiris.reconciled',prior.export_id,jsonb_build_object(
  'send_id',prior.id,'company_key',prior.company_key,'outcome','confirmed_sent','prior_status',prior.status,
  'prior_error_code',prior.error_code,'voucher_id',voucher,'voucher_number',number,'evidence',evidence));
 return komisio_private.spiris_send_state(result);
end $$;
revoke all on function public.begin_spiris_send(uuid,uuid,uuid),public.complete_spiris_send(uuid,uuid,text,text,text,text,text),public.reconcile_spiris_send(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.begin_spiris_send(uuid,uuid,uuid),public.complete_spiris_send(uuid,uuid,text,text,text,text,text),public.reconcile_spiris_send(uuid,uuid,text,text,text,text) to authenticated;
