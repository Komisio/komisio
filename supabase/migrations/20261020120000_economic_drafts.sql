-- Separate destination facts; existing SIE/Fortnox maps and exports are unchanged.
create table public.economic_connections (
 tenant_id uuid primary key references public.tenants(id),
 agreement_number integer not null check(agreement_number>0),
 company_name text not null check(length(company_name) between 1 and 200),
 organisation_number text not null check(length(organisation_number)<=40),
 currency text not null check(currency='DKK'),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data']),
 revision uuid not null default gen_random_uuid(),
 connected_by uuid not null references auth.users(id),
 connected_at timestamptz not null default now()
);
create table public.economic_connection_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('connected','checked','refused','disconnected')),
 agreement_number integer,
 reason text not null default '' check(reason in ('','ECONOMIC_WRONG_AGREEMENT','ECONOMIC_CURRENCY_UNSUPPORTED','ECONOMIC_AUTH_REQUIRED','ECONOMIC_ACCESS_DENIED','ECONOMIC_READ_FAILED')),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now()
);
create index economic_connection_events_tenant on public.economic_connection_events(tenant_id,occurred_at desc);
create table public.economic_maps (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid references public.economic_maps(id),
 agreement_number integer not null check(agreement_number>0),
 journal_number integer not null check(journal_number>0),
 map jsonb not null,
 published_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,version)
);
create table public.economic_exports (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 day_close_id uuid not null,
 map_id uuid not null,
 agreement_number integer not null check(agreement_number>0),
 journal_number integer not null check(journal_number>0),
 voucher jsonb not null check(jsonb_typeof(voucher)='array' and jsonb_array_length(voucher)>0),
 excluded jsonb not null check(jsonb_typeof(excluded)='object'),
 debit_ore bigint not null check(debit_ore>0),
 credit_ore bigint not null check(credit_ore=debit_ore),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,day_close_id,map_id),
 foreign key(tenant_id,day_close_id) references public.day_closes(tenant_id,id),
 foreign key(tenant_id,map_id) references public.economic_maps(tenant_id,id)
);
create index economic_exports_tenant on public.economic_exports(tenant_id,created_at desc);
create table public.economic_sends (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 export_id uuid not null,
 agreement_number integer not null check(agreement_number>0),
 journal_number integer not null check(journal_number>0),
 status text not null default 'pending' check(status in ('pending','sent','failed')),
 voucher_number integer check(voucher_number between 0 and 999999999),
 error_code text not null default '' check(error_code in ('','ECONOMIC_PREFLIGHT_FAILED','ECONOMIC_OUTCOME_UNKNOWN')),
 reason text not null default '' check(length(reason)<=80 and reason ~ '^[A-Z_]*$'),
 retry_after timestamptz,
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(tenant_id,id),
 foreign key(tenant_id,export_id) references public.economic_exports(tenant_id,id),
 check((status='pending')=(completed_at is null)),
 check((status='sent')=(voucher_number is not null)),
 check((status='failed')=(error_code<>''))
);
create unique index economic_sends_once on public.economic_sends(tenant_id,export_id) where status in ('pending','sent');
create index economic_sends_tenant on public.economic_sends(tenant_id,created_at desc);
create table public.economic_send_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 send_id uuid not null,
 journal_number integer not null check(journal_number>0),
 voucher_number integer not null check(voucher_number between 0 and 999999999),
 evidence text not null check(length(trim(evidence)) between 1 and 500),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 unique(send_id),
 foreign key(tenant_id,send_id) references public.economic_sends(tenant_id,id)
);
do $$
declare t text;
begin
 foreach t in array array['economic_connections','economic_connection_events','economic_maps','economic_exports','economic_sends','economic_send_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  if t<>'economic_connections' then
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy %I on public.%I for select to authenticated using(tenant_id in(select public.user_tenant_ids()))',t||'_read',t);
  end if;
 end loop;
 foreach t in array array['economic_connection_events','economic_maps','economic_exports','economic_send_events'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function komisio_private.preserve_accounting_row()',t||'_immutable',t);
 end loop;
end $$;
create function komisio_private.guard_economic_transition() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.economic_transition',true) is distinct from 'engine' then raise exception 'IMMUTABLE_CONNECTION' using errcode='55000'; end if;
 if tg_table_name='economic_sends' then
  if tg_op='DELETE' then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
  if old.status<>'pending' or new.status='pending'
   or (to_jsonb(new)-array['status','voucher_number','error_code','reason','retry_after','completed_at'])
       is distinct from (to_jsonb(old)-array['status','voucher_number','error_code','reason','retry_after','completed_at'])
  then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_economic_transition() from public,anon,authenticated;
create trigger economic_connections_guard before update or delete on public.economic_connections for each row execute function komisio_private.guard_economic_transition();
create trigger economic_sends_guard before update or delete on public.economic_sends for each row execute function komisio_private.guard_economic_transition();

create function public.economic_connection_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.economic_connections;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.economic_connections where tenant_id=p_tenant;
 return jsonb_build_object('connected',found,'agreementNumber',c.agreement_number,'companyName',c.company_name,'organisationNumber',c.organisation_number,'connectedAt',c.connected_at,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'agreementNumber',e.agreement_number,'reason',e.reason,'occurredAt',e.occurred_at) order by e.occurred_at desc),'[]') from
   (select * from public.economic_connection_events where tenant_id=p_tenant order by occurred_at desc limit 20) e));
end $$;
create function public.read_economic_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.economic_connections;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.economic_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('agreementNumber',c.agreement_number,'cipher',c.cipher,'revision',c.revision);
end $$;
create function public.store_economic_connection(p_tenant uuid,p_agreement integer,p_name text,p_organisation text,p_currency text,p_cipher jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.economic_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_agreement is null or p_agreement<=0 or p_name is null or length(trim(p_name)) not between 1 and 200
  or p_organisation is null or length(p_organisation)>40 or p_cipher is null or jsonb_typeof(p_cipher)<>'object'
  or not(p_cipher ?& array['iv','tag','data']) or (p_cipher-array['iv','tag','data'])<>'{}'
  or jsonb_typeof(p_cipher->'iv')<>'string' or length(p_cipher->>'iv') not between 1 and 128
  or jsonb_typeof(p_cipher->'tag')<>'string' or length(p_cipher->>'tag') not between 1 and 128
  or jsonb_typeof(p_cipher->'data')<>'string' or length(p_cipher->>'data') not between 1 and 16384
 then raise exception 'INVALID_INPUT'; end if;
 if p_currency is distinct from 'DKK' or komisio_private.store_currency(p_tenant)<>'DKK' then raise exception 'ECONOMIC_CURRENCY_UNSUPPORTED'; end if;
 select * into prior from public.economic_connections where tenant_id=p_tenant;
 if found and prior.agreement_number<>p_agreement then raise exception 'ECONOMIC_WRONG_AGREEMENT'; end if;
 perform set_config('komisio.economic_transition','engine',true);
 insert into public.economic_connections(tenant_id,agreement_number,company_name,organisation_number,currency,cipher,connected_by)
 values(p_tenant,p_agreement,trim(p_name),trim(p_organisation),'DKK',p_cipher,uid)
 on conflict(tenant_id) do update set company_name=excluded.company_name,organisation_number=excluded.organisation_number,cipher=excluded.cipher,revision=gen_random_uuid(),connected_by=uid,connected_at=now();
 perform set_config('komisio.economic_transition','',true);
 insert into public.economic_connection_events(tenant_id,kind,agreement_number,actor) values(p_tenant,'connected',p_agreement,uid);
end $$;
create function public.record_economic_check(p_tenant uuid,p_kind text,p_agreement integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('checked','refused') then raise exception 'INVALID_INPUT'; end if;
 insert into public.economic_connection_events(tenant_id,kind,agreement_number,reason,actor) values(p_tenant,p_kind,p_agreement,p_reason,uid);
end $$;
create function public.disconnect_economic(p_tenant uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.economic_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.economic_connections where tenant_id=p_tenant;
 if not found then return false; end if;
 perform set_config('komisio.economic_transition','engine',true);
 delete from public.economic_connections where tenant_id=p_tenant;
 perform set_config('komisio.economic_transition','',true);
 insert into public.economic_connection_events(tenant_id,kind,agreement_number,actor) values(p_tenant,'disconnected',c.agreement_number,uid);
 return true;
end $$;

create function komisio_private.valid_economic_map(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 for k,v in select * from jsonb_each(value) loop
  if not(k=any(komisio_private.accounting_keys())) or jsonb_typeof(v)<>'object' then return false; end if;
  if v ? 'excludeReason' then
   if k like 'mode:consignment_fee%' or (v-'excludeReason')<>'{}' or jsonb_typeof(v->'excludeReason')<>'string'
    or length(trim(v->>'excludeReason')) not between 1 and 500 then return false; end if;
  else
   if not(v ?& array['account','side','vatCode']) or (v-array['account','side','vatCode'])<>'{}'
    or jsonb_typeof(v->'account')<>'string' or (v->>'account') !~ '^[1-9][0-9]{0,9}$'
    or jsonb_typeof(v->'side')<>'string' or v->>'side' not in ('debit','credit')
    or jsonb_typeof(v->'vatCode')<>'string' or (v->>'vatCode') !~ '^[A-Za-z0-9]{1,5}$'
   then return false; end if;
   if (v->>'account')::numeric>2147483647 then return false; end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function komisio_private.valid_economic_map(jsonb) from public,anon,authenticated;
alter table public.economic_maps add constraint economic_maps_valid check(komisio_private.valid_economic_map(map));
create function public.current_economic_map(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.economic_maps;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into m from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',m.id,'version',coalesce(m.version,0),'map',coalesce(m.map,'{}'),'agreementNumber',m.agreement_number,'journalNumber',m.journal_number);
end $$;
create function public.publish_economic_map(p_tenant uuid,p_id uuid,p_expected_current uuid,p_agreement integer,p_journal integer,p_map jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.economic_maps; latest public.economic_maps;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_agreement is null or p_journal is null or p_agreement<=0 or p_journal<=0 or not komisio_private.valid_economic_map(p_map) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.economic_maps where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.published_by<>uid or prior.map<>p_map or prior.agreement_number<>p_agreement or prior.journal_number<>p_journal
   or prior.previous_id is distinct from p_expected_current then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.economic_connections where tenant_id=p_tenant and agreement_number=p_agreement) then raise exception 'ECONOMIC_WRONG_AGREEMENT'; end if;
 if komisio_private.store_currency(p_tenant)<>'DKK' then raise exception 'ECONOMIC_CURRENCY_UNSUPPORTED'; end if;
 select * into latest from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 if latest.id is distinct from p_expected_current then raise exception 'MAP_CHANGED'; end if;
 insert into public.economic_maps(id,tenant_id,version,previous_id,agreement_number,journal_number,map,published_by)
 values(p_id,p_tenant,coalesce(latest.version,0)+1,latest.id,p_agreement,p_journal,p_map,uid);
 perform komisio_private.record_access(p_tenant,'economic.map_published',p_id,jsonb_build_object('version',coalesce(latest.version,0)+1));
 return p_id;
end $$;
create function komisio_private.economic_voucher_for(c public.day_closes,m jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare projected jsonb:='{}'; raw jsonb; l jsonb; k text; entry jsonb; lines jsonb:='[]'; missing jsonb:='[]'; excluded jsonb:='{}'; debit bigint:=0; credit bigint:=0;
begin
 -- Reuse the existing amount-key projection, including fee amounts, without
 -- changing its historical selective-export rule or its arithmetic.
 foreach k in array komisio_private.accounting_keys() loop
  projected:=projected||jsonb_build_object(k,jsonb_build_object('account','1000','side','debit'));
 end loop;
 raw:=komisio_private.voucher_for(c,projected);
 for l in select * from jsonb_array_elements(raw->'lines') loop
  k:=l->>'key'; entry:=m->k;
  if entry is null then missing:=missing||to_jsonb(k);
  elsif entry ? 'excludeReason' then
   excluded:=excluded||jsonb_build_object(k,jsonb_build_object('amountOre',l->'amountOre','reason',entry->>'excludeReason'));
  else
   lines:=lines||jsonb_build_object('key',k,'account',entry->>'account','side',entry->>'side','vatCode',entry->>'vatCode','amountOre',l->'amountOre');
   if entry->>'side'='debit' then debit:=debit+(l->>'amountOre')::bigint; else credit:=credit+(l->>'amountOre')::bigint; end if;
  end if;
 end loop;
 return jsonb_build_object('lines',lines,'excluded',excluded,'unmapped',missing,'debitOre',debit,'creditOre',credit,
  'balanced',debit=credit and debit>0 and jsonb_array_length(missing)=0);
end $$;
revoke all on function komisio_private.economic_voucher_for(public.day_closes,jsonb) from public,anon,authenticated;
create function public.preview_economic_voucher(p_tenant uuid,p_day_close uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.day_closes; m public.economic_maps;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.day_closes where tenant_id=p_tenant and id=p_day_close;
 if not found then raise exception 'DAY_CLOSE_NOT_FOUND'; end if;
 select * into m from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 return komisio_private.economic_voucher_for(c,coalesce(m.map,'{}'))||jsonb_build_object('dayCloseId',c.id,'closeDate',c.close_date,'closeVersion',c.version,
  'mapId',m.id,'mapVersion',coalesce(m.version,0),'agreementNumber',m.agreement_number,'journalNumber',m.journal_number,
  'exportId',(select id from public.economic_exports where tenant_id=p_tenant and day_close_id=c.id and map_id=m.id));
end $$;
create function public.export_economic_day_close(p_tenant uuid,p_id uuid,p_day_close uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.economic_exports; c public.day_closes; m public.economic_maps; v jsonb; existing uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_day_close is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.economic_exports where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.day_close_id<>p_day_close or prior.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if komisio_private.store_currency(p_tenant)<>'DKK' then raise exception 'ECONOMIC_CURRENCY_UNSUPPORTED'; end if;
 select * into c from public.day_closes where tenant_id=p_tenant and id=p_day_close;
 if not found then raise exception 'DAY_CLOSE_NOT_FOUND'; end if;
 select * into m from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 if not found then raise exception 'ACCOUNTING_MAP_REQUIRED'; end if;
 select id into existing from public.economic_exports where tenant_id=p_tenant and day_close_id=c.id and map_id=m.id;
 if found then return existing; end if;
 if not exists(select 1 from public.economic_connections where tenant_id=p_tenant and agreement_number=m.agreement_number) then raise exception 'ECONOMIC_WRONG_AGREEMENT'; end if;
 v:=komisio_private.economic_voucher_for(c,m.map);
 if jsonb_array_length(v->'unmapped')>0 then raise exception 'ECONOMIC_MAP_INCOMPLETE'; end if;
 if not(v->>'balanced')::boolean then raise exception 'VOUCHER_UNBALANCED'; end if;
 insert into public.economic_exports(id,tenant_id,day_close_id,map_id,agreement_number,journal_number,voucher,excluded,debit_ore,credit_ore,created_by)
 values(p_id,p_tenant,c.id,m.id,m.agreement_number,m.journal_number,v->'lines',v->'excluded',(v->>'debitOre')::bigint,(v->>'creditOre')::bigint,uid);
 perform komisio_private.record_access(p_tenant,'economic.exported',p_id,jsonb_build_object('day_close_id',c.id,'map_version',m.version));
 return p_id;
end $$;

create function komisio_private.economic_send_state(s public.economic_sends) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',s.id,'exportId',s.export_id,'status',case when confirmation.id is not null then 'sent' else s.status end,
  'agreementNumber',s.agreement_number,'journalNumber',s.journal_number,'voucherNumber',coalesce(confirmation.voucher_number,s.voucher_number),
  'errorCode',case when confirmation.id is not null then '' else s.error_code end,'reason',case when confirmation.id is not null then '' else s.reason end,
  'retryAfter',s.retry_after,'closeDate',c.close_date,'closeVersion',c.version,'lines',e.voucher,'createdAt',s.created_at,'dispatchAllowed',false)
 from public.economic_exports e join public.day_closes c on c.tenant_id=e.tenant_id and c.id=e.day_close_id
 left join public.economic_send_events confirmation on confirmation.tenant_id=s.tenant_id and confirmation.send_id=s.id
 where e.tenant_id=s.tenant_id and e.id=s.export_id
$$;
revoke all on function komisio_private.economic_send_state(public.economic_sends) from public,anon,authenticated;
create function public.begin_economic_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.economic_connections; e public.economic_exports; s public.economic_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.economic_sends where id=p_id;
 if found then
  if s.tenant_id<>p_tenant or s.export_id<>p_export or s.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.economic_send_state(s);
 end if;
 select * into c from public.economic_connections where tenant_id=p_tenant;
 if not found then raise exception 'ECONOMIC_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'DKK' then raise exception 'ECONOMIC_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.economic_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 if e.agreement_number<>c.agreement_number then raise exception 'ECONOMIC_WRONG_AGREEMENT'; end if;
 if exists(select 1 from public.economic_sends sent_row left join public.economic_send_events ev on ev.send_id=sent_row.id where sent_row.tenant_id=p_tenant and sent_row.export_id=p_export and (sent_row.status='sent' or ev.id is not null)) then raise exception 'ECONOMIC_ALREADY_SENT'; end if;
 if exists(select 1 from public.economic_sends where tenant_id=p_tenant and export_id=p_export and status='pending') then raise exception 'ECONOMIC_SEND_IN_PROGRESS'; end if;
 if exists(select 1 from public.economic_sends where tenant_id=p_tenant and export_id=p_export and error_code='ECONOMIC_OUTCOME_UNKNOWN') then raise exception 'ECONOMIC_OUTCOME_UNKNOWN'; end if;
 if exists(select 1 from public.economic_sends where tenant_id=p_tenant and export_id=p_export and retry_after>now()) then raise exception 'ECONOMIC_RATE_LIMITED'; end if;
 insert into public.economic_sends(id,tenant_id,export_id,agreement_number,journal_number,actor) values(p_id,p_tenant,p_export,c.agreement_number,e.journal_number,uid) returning * into s;
 return komisio_private.economic_send_state(s)||jsonb_build_object('dispatchAllowed',true);
end $$;
create function public.complete_economic_send(p_tenant uuid,p_id uuid,p_status text,p_number integer,p_error text,p_reason text,p_retry_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.economic_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status is null or p_status not in ('sent','failed')
  or (p_status='sent' and (p_number is null or p_number not between 0 and 999999999 or p_error is distinct from '' or p_reason is distinct from ''))
  or (p_status='failed' and (p_number is not null or p_error is null or p_error not in ('ECONOMIC_PREFLIGHT_FAILED','ECONOMIC_OUTCOME_UNKNOWN') or p_reason is null or p_reason !~ '^[A-Z_]{1,80}$'))
  or (p_retry_seconds is not null and p_retry_seconds not between 0 and 86400) then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.economic_sends where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if s.actor<>uid then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if s.status<>'pending' then
  if s.status=p_status and s.voucher_number is not distinct from p_number and s.error_code=p_error and s.reason=p_reason then return komisio_private.economic_send_state(s); end if;
  raise exception 'SEND_NOT_PENDING';
 end if;
 if exists(select 1 from public.economic_send_events where send_id=s.id) then raise exception 'SEND_NOT_PENDING'; end if;
 perform set_config('komisio.economic_transition','engine',true);
 update public.economic_sends set status=p_status,voucher_number=p_number,error_code=p_error,reason=p_reason,
  retry_after=case when p_retry_seconds is not null then now()+make_interval(secs=>p_retry_seconds) end,completed_at=now()
 where id=s.id returning * into s;
 perform set_config('komisio.economic_transition','',true);
 perform komisio_private.record_access(p_tenant,'economic.send_'||p_status,s.id,jsonb_build_object('export_id',s.export_id,'error_code',s.error_code));
 return komisio_private.economic_send_state(s);
end $$;
create function public.confirm_economic_send(p_tenant uuid,p_send uuid,p_journal integer,p_voucher integer,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.economic_sends; prior public.economic_send_events;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_send is null or p_journal is null or p_voucher is null or p_journal<=0 or p_voucher not between 0 and 999999999
  or p_evidence is null or length(trim(p_evidence)) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.economic_sends where tenant_id=p_tenant and id=p_send;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 select * into prior from public.economic_send_events where tenant_id=p_tenant and send_id=p_send;
 if found then
  if prior.actor<>uid or prior.journal_number<>p_journal or prior.voucher_number<>p_voucher or prior.evidence<>trim(p_evidence) then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.economic_send_state(s);
 end if;
 if s.journal_number<>p_journal then raise exception 'REQUEST_CONFLICT'; end if;
 if s.status='sent' or (s.status='failed' and s.error_code<>'ECONOMIC_OUTCOME_UNKNOWN') then raise exception 'SEND_NOT_PENDING'; end if;
 insert into public.economic_send_events(tenant_id,send_id,journal_number,voucher_number,evidence,actor) values(p_tenant,p_send,p_journal,p_voucher,trim(p_evidence),uid);
 perform komisio_private.record_access(p_tenant,'economic.send_confirmed',s.id,jsonb_build_object('journal_number',p_journal,'voucher_number',p_voucher));
 return komisio_private.economic_send_state(s);
end $$;
create function public.economic_send_status(p_tenant uuid,p_export uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.economic_sends;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select es.* into s from public.economic_sends es left join public.economic_send_events ev on ev.send_id=es.id
 where es.tenant_id=p_tenant and es.export_id=p_export order by (es.status in ('pending','sent') or ev.id is not null) desc,es.created_at desc limit 1;
 if not found then return null; end if;
 return komisio_private.economic_send_state(s);
end $$;
create function public.economic_reconciliation(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; day jsonb; rows jsonb:='[]'; counts jsonb:='{}'; m public.economic_maps; e public.economic_exports; s jsonb; state text;
begin
 -- Reuse the established activity/stale-close calculation, then replace only
 -- the destination-specific export and send facts. No SIE/Fortnox writes.
 base:=public.accounting_reconciliation(p_tenant,p_from,p_to);
 select * into m from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 for day in select * from jsonb_array_elements(base->'days') loop
  e:=null; s:=null; state:=day->>'status';
  if state not in ('no_close','close_stale') then
   select * into e from public.economic_exports where tenant_id=p_tenant and day_close_id=(day->'close'->>'id')::uuid
    order by (m.id is not null and map_id=m.id) desc,created_at desc limit 1;
   if not found then state:='not_exported';
   elsif e.map_id is distinct from m.id then state:='export_outdated';
   else
    s:=public.economic_send_status(p_tenant,e.id);
    state:=case when s is null then 'not_sent' when s->>'status'='sent' then 'sent' when s->>'status'='pending' then 'send_pending' else 'send_failed' end;
   end if;
  end if;
  rows:=rows||((day-array['export','send','status'])||jsonb_build_object('status',state,
   'export',case when e.id is null then null else jsonb_build_object('id',e.id,'mapId',e.map_id,'createdAt',e.created_at) end,
   'send',case when s is null then null else jsonb_build_object('id',s->>'sendId','status',s->>'status','voucherSeries',(s->>'journalNumber'),
    'voucherNumber',s->'voucherNumber','errorCode',s->>'errorCode','createdAt',s->>'createdAt') end));
  counts:=counts||jsonb_build_object(state,coalesce((counts->>state)::integer,0)+1);
 end loop;
 return base||jsonb_build_object('mapVersion',coalesce(m.version,0),'days',rows,'counts',counts);
end $$;
create function public.economic_export_page(p_tenant uuid,p_export uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object(
   'day_closes',jsonb_build_object('close_date',c.close_date,'version',c.version),
   'economic_maps',jsonb_build_object('version',m.version),
   'send',public.economic_send_status(p_tenant,e.id)) order by e.created_at desc),'[]')
  from (select * from public.economic_exports where tenant_id=p_tenant and (p_export is null or id=p_export) order by created_at desc limit 60) e
  join public.day_closes c on c.tenant_id=p_tenant and c.id=e.day_close_id
  join public.economic_maps m on m.tenant_id=p_tenant and m.id=e.map_id);
end $$;
do $$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
  'economic_connection_status','read_economic_connection','store_economic_connection','record_economic_check','disconnect_economic',
  'current_economic_map','publish_economic_map','preview_economic_voucher','export_economic_day_close','begin_economic_send','complete_economic_send','confirm_economic_send','economic_send_status','economic_reconciliation','economic_export_page'
 ]) loop
  execute format('revoke all on function %s from public,anon',f);
  execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;
