-- P2 S17 accounting export, file based. The tenant publishes an account map
-- set with its accountant: for each day-close amount, an account number and a
-- side, or nothing. Komisio proposes no chart of accounts and no postings; it
-- turns one day close and one map version into voucher lines, refuses an
-- unbalanced voucher, and records each export once per day close and map
-- version. The SIE4 file is rendered by the application from the recorded
-- lines, so the file can be downloaded again without a second export.
create table public.accounting_maps (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 map jsonb not null,
 published_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,version)
);
alter table public.accounting_maps enable row level security;
create policy accounting_maps_read on public.accounting_maps for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.accounting_maps from public,anon,authenticated;
grant select on public.accounting_maps to authenticated;
create table public.accounting_exports (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 day_close_id uuid not null,
 map_id uuid not null references public.accounting_maps(id),
 format text not null default 'sie4' check(format in ('sie4')),
 voucher jsonb not null check(jsonb_typeof(voucher)='array'),
 debit_ore bigint not null check(debit_ore>=0),
 credit_ore bigint not null check(credit_ore>=0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,day_close_id) references public.day_closes(tenant_id,id),
 unique(tenant_id,day_close_id,map_id)
);
create index accounting_exports_tenant on public.accounting_exports(tenant_id,created_at desc);
alter table public.accounting_exports enable row level security;
create policy accounting_exports_read on public.accounting_exports for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.accounting_exports from public,anon,authenticated;
grant select on public.accounting_exports to authenticated;
create function komisio_private.preserve_accounting_row() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_ACCOUNTING_ROW' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_accounting_row() from public,anon,authenticated;
create trigger accounting_maps_immutable before update or delete on public.accounting_maps for each row execute function komisio_private.preserve_accounting_row();
create trigger accounting_exports_immutable before update or delete on public.accounting_exports for each row execute function komisio_private.preserve_accounting_row();

-- The amounts a day close exposes. Mode keys exist for every VAT mode so a
-- tenant's mode change stays visible in the books.
create function komisio_private.accounting_keys() returns text[]
language sql immutable set search_path='' as $$
 select array['grossOre','refundsOre','commissionOre','commissionVatOre','sellerCreditOre','creditReversedOre','payoutsPaidOre',
  'mode:consignment_margin:netOre','mode:consignment_margin:vatOre','mode:consignment_full:netOre','mode:consignment_full:vatOre',
  'mode:consignment_business:netOre','mode:consignment_business:vatOre','mode:store_margin:netOre','mode:store_margin:vatOre',
  'mode:store_full:netOre','mode:store_full:vatOre']
$$;
create function komisio_private.valid_accounting_map(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 for k,v in select * from jsonb_each(value) loop
  if not (k=any(komisio_private.accounting_keys())) then return false; end if;
  if jsonb_typeof(v)<>'object' or not(v ?& array['account','side']) or (v-array['account','side'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(v->'account')<>'string' or (v->>'account') !~ '^[1-9][0-9]{3}$' then return false; end if;
  if jsonb_typeof(v->'side')<>'string' or v->>'side' not in ('debit','credit') then return false; end if;
 end loop;
 return true;
end $$;
alter table public.accounting_maps add constraint accounting_maps_map_check check(komisio_private.valid_accounting_map(map));

create function public.publish_accounting_map(p_tenant uuid,p_id uuid,p_expected_current uuid,p_map jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.accounting_maps; latest public.accounting_maps;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_accounting_map(p_map) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.accounting_maps where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.map is distinct from p_map or prior.published_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into latest from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 if (latest.id is null)<>(p_expected_current is null) or latest.id is distinct from p_expected_current then raise exception 'MAP_CHANGED'; end if;
 insert into public.accounting_maps(id,tenant_id,version,previous_id,map,published_by) values(p_id,p_tenant,coalesce(latest.version,0)+1,latest.id,p_map,uid);
 perform komisio_private.record_access(p_tenant,'accounting_map.published',p_id,jsonb_build_object('version',coalesce(latest.version,0)+1,'keys',(select count(*) from jsonb_object_keys(p_map))));
 return p_id;
end $$;
create function public.current_accounting_map(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare latest public.accounting_maps;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into latest from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',latest.id,'version',coalesce(latest.version,0),'map',coalesce(latest.map,'{}'::jsonb),'keys',to_jsonb(komisio_private.accounting_keys()));
end $$;

-- Voucher lines for one day close under one map: every mapped amount that is
-- not zero becomes one line; unmapped non-zero amounts are reported, never
-- silently dropped into a balancing line.
create function komisio_private.voucher_for(p_close public.day_closes,p_map jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; amount bigint; entry jsonb; lines jsonb:='[]'::jsonb; unmapped text[]:='{}'; debit bigint:=0; credit bigint:=0; parts text[];
begin
 foreach k in array komisio_private.accounting_keys() loop
  if k like 'mode:%' then
   parts:=string_to_array(k,':');
   amount:=coalesce((p_close.per_mode->parts[2]->>parts[3])::bigint,0);
  else
   amount:=case k
    when 'grossOre' then p_close.gross_ore when 'refundsOre' then p_close.refunds_ore when 'commissionOre' then p_close.commission_ore
    when 'commissionVatOre' then p_close.commission_vat_ore when 'sellerCreditOre' then p_close.seller_credit_ore
    when 'creditReversedOre' then p_close.credit_reversed_ore when 'payoutsPaidOre' then p_close.payouts_paid_ore end;
  end if;
  if amount=0 then continue; end if;
  entry:=p_map->k;
  if entry is null then unmapped:=array_append(unmapped,k); continue; end if;
  lines:=lines||jsonb_build_object('key',k,'account',entry->>'account','side',entry->>'side','amountOre',abs(amount));
  if entry->>'side'='debit' then debit:=debit+abs(amount); else credit:=credit+abs(amount); end if;
 end loop;
 return jsonb_build_object('lines',lines,'debitOre',debit,'creditOre',credit,'balanced',debit=credit and jsonb_array_length(lines)>0,'unmapped',to_jsonb(unmapped));
end $$;
revoke all on function komisio_private.voucher_for(public.day_closes,jsonb),komisio_private.accounting_keys(),komisio_private.valid_accounting_map(jsonb) from public,anon,authenticated;

create function public.preview_voucher(p_tenant uuid,p_day_close uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare close public.day_closes; latest public.accounting_maps; v jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into close from public.day_closes where tenant_id=p_tenant and id=p_day_close;
 if not found then raise exception 'DAY_CLOSE_NOT_FOUND'; end if;
 select * into latest from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 v:=komisio_private.voucher_for(close,coalesce(latest.map,'{}'::jsonb));
 return v||jsonb_build_object('dayCloseId',close.id,'closeDate',close.close_date,'closeVersion',close.version,'mapId',latest.id,'mapVersion',coalesce(latest.version,0),
  'exportId',(select e.id from public.accounting_exports e where e.tenant_id=p_tenant and e.day_close_id=close.id and e.map_id=latest.id));
end $$;

-- One export per day close and map version; a repeat returns the same row.
create function public.export_day_close(p_tenant uuid,p_id uuid,p_day_close uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.accounting_exports; close public.day_closes; latest public.accounting_maps; v jsonb; existing uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_day_close is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.accounting_exports where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.day_close_id is distinct from p_day_close or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into close from public.day_closes where tenant_id=p_tenant and id=p_day_close;
 if not found then raise exception 'DAY_CLOSE_NOT_FOUND'; end if;
 select * into latest from public.accounting_maps where tenant_id=p_tenant order by version desc limit 1;
 if not found then raise exception 'ACCOUNTING_MAP_REQUIRED'; end if;
 select e.id into existing from public.accounting_exports e where e.tenant_id=p_tenant and e.day_close_id=close.id and e.map_id=latest.id;
 if existing is not null then return existing; end if;
 v:=komisio_private.voucher_for(close,latest.map);
 if jsonb_array_length(v->'lines')=0 then raise exception 'ACCOUNTING_MAP_REQUIRED'; end if;
 if not (v->>'balanced')::boolean then raise exception 'VOUCHER_UNBALANCED'; end if;
 insert into public.accounting_exports(id,tenant_id,day_close_id,map_id,voucher,debit_ore,credit_ore,created_by)
 values(p_id,p_tenant,close.id,latest.id,v->'lines',(v->>'debitOre')::bigint,(v->>'creditOre')::bigint,uid);
 perform komisio_private.record_access(p_tenant,'day_close.exported',p_id,jsonb_build_object('day_close_id',close.id,'map_version',latest.version,'lines',jsonb_array_length(v->'lines')));
 return p_id;
end $$;
revoke all on function public.publish_accounting_map(uuid,uuid,uuid,jsonb),public.current_accounting_map(uuid),public.preview_voucher(uuid,uuid),public.export_day_close(uuid,uuid,uuid) from public,anon;
grant execute on function public.publish_accounting_map(uuid,uuid,uuid,jsonb),public.current_accounting_map(uuid),public.preview_voucher(uuid,uuid),public.export_day_close(uuid,uuid,uuid) to authenticated;
