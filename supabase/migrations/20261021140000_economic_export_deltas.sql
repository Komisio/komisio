-- Export revisions are immutable differences against a confirmed daily target.
-- Legacy exports retain their original full-snapshot meaning and are not rewritten.
alter table public.economic_exports
 add column baseline_export_id uuid,
 add column target_voucher jsonb check(target_voucher is null or jsonb_typeof(target_voucher)='array'),
 add foreign key(tenant_id,baseline_export_id) references public.economic_exports(tenant_id,id);
alter table public.economic_exports drop constraint economic_exports_tenant_id_day_close_id_map_id_key;
create unique index economic_exports_baseline_once on public.economic_exports
 (tenant_id,day_close_id,map_id,baseline_export_id) nulls not distinct;

-- Caller holds the tenant lock for mutations. A read can be stale, never a send.
create function komisio_private.economic_day_baseline(p_tenant uuid,p_date date) returns jsonb
language plpgsql stable set search_path='' as $$
declare e public.economic_exports; baseline uuid; last_version integer:=0; next_version integer;
begin
 if exists(select 1 from public.economic_sends s
  join public.economic_exports x on x.tenant_id=s.tenant_id and x.id=s.export_id
  join public.day_closes c on c.tenant_id=x.tenant_id and c.id=x.day_close_id
  where s.tenant_id=p_tenant and c.close_date=p_date
   and (s.status='pending' or s.error_code='ECONOMIC_OUTCOME_UNKNOWN')
   and not exists(select 1 from public.economic_send_events ev where ev.tenant_id=s.tenant_id and ev.send_id=s.id))
 then return jsonb_build_object('blockedReason','ECONOMIC_DAY_UNRESOLVED'); end if;
 for e in select x.* from public.economic_exports x
  join public.day_closes c on c.tenant_id=x.tenant_id and c.id=x.day_close_id
  where x.tenant_id=p_tenant and c.close_date=p_date
   and exists(select 1 from public.economic_sends s where s.tenant_id=x.tenant_id and s.export_id=x.id
    and (s.status='sent' or exists(select 1 from public.economic_send_events ev where ev.tenant_id=s.tenant_id and ev.send_id=s.id)))
  order by c.version,x.created_at,x.id
 loop
  select version into next_version from public.day_closes where tenant_id=p_tenant and id=e.day_close_id;
  -- More than one historical full export, or a broken difference chain, needs
  -- explicit reconciliation. Never infer a correcting reversal from those rows.
  if e.baseline_export_id is distinct from baseline or (baseline is not null and (e.target_voucher is null or next_version<=last_version)) then
   return jsonb_build_object('blockedReason','ECONOMIC_DAY_HISTORY_REVIEW');
  end if;
  baseline:=e.id; last_version:=next_version;
 end loop;
 return jsonb_build_object('baselineExportId',baseline,'baselineCloseVersion',last_version,'blockedReason','');
end $$;
revoke all on function komisio_private.economic_day_baseline(uuid,date) from public,anon,authenticated;

create function komisio_private.economic_delta_preview(c public.day_closes,m public.economic_maps) returns jsonb
language plpgsql stable set search_path='' as $$
declare state jsonb; full_target jsonb; b public.economic_exports; bm public.economic_maps;
 result jsonb; delta_lines jsonb; debit bigint; credit bigint; reason text;
begin
 full_target:=komisio_private.economic_voucher_for(c,coalesce(m.map,'{}'));
 state:=komisio_private.economic_day_baseline(c.tenant_id,c.close_date);
 reason:=state->>'blockedReason';
 if reason='' and state->>'baselineExportId' is not null then
  select * into b from public.economic_exports where tenant_id=c.tenant_id and id=(state->>'baselineExportId')::uuid;
  select * into bm from public.economic_maps where tenant_id=c.tenant_id and id=b.map_id;
  if b.agreement_number is distinct from m.agreement_number or b.journal_number is distinct from m.journal_number or bm.map is distinct from m.map then
   reason:='ECONOMIC_DAY_CONTEXT_CHANGED';
  elsif c.version<(state->>'baselineCloseVersion')::integer then reason:='ECONOMIC_BASELINE_CHANGED';
  end if;
 end if;
 if reason<>'' then
  return full_target||state||jsonb_build_object('lines','[]'::jsonb,'debitOre',0,'creditOre',0,'balanced',false,'blockedReason',reason,'targetVoucher',full_target->'lines');
 end if;
 -- Compare signed integer ore by frozen posting identity. A decrease swaps side;
 -- absolute-value subtraction would silently lose reversals.
 with signed as (
  select l->>'key' k,l->>'account' account,l->>'vatCode' vat,
   (l->>'amountOre')::numeric*case when l->>'side'='debit' then 1 else -1 end amount
  from jsonb_array_elements(full_target->'lines') l
  union all
  select l->>'key',l->>'account',l->>'vatCode',
   -(l->>'amountOre')::numeric*case when l->>'side'='debit' then 1 else -1 end
  from jsonb_array_elements(coalesce(b.target_voucher,b.voucher,'[]')) l
 ), net as (select k,account,vat,sum(amount) amount from signed group by k,account,vat having sum(amount)<>0)
 select coalesce(jsonb_agg(jsonb_build_object('key',k,'account',account,'vatCode',vat,
  'side',case when amount>0 then 'debit' else 'credit' end,'amountOre',abs(amount)) order by k,account,vat),'[]'),
  coalesce(sum(amount) filter(where amount>0),0)::bigint,coalesce(-sum(amount) filter(where amount<0),0)::bigint
 into delta_lines,debit,credit from net;
 result:=full_target||state||jsonb_build_object('lines',delta_lines,'debitOre',debit,'creditOre',credit,
  'balanced',debit=credit and debit>0 and jsonb_array_length(full_target->'unmapped')=0,
  'targetVoucher',full_target->'lines');
 if jsonb_array_length(delta_lines)=0 and jsonb_array_length(full_target->'unmapped')=0 then
  result:=result||jsonb_build_object('blockedReason','ECONOMIC_NO_CHANGES');
 end if;
 return result;
end $$;
revoke all on function komisio_private.economic_delta_preview(public.day_closes,public.economic_maps) from public,anon,authenticated;

create or replace function public.preview_economic_voucher(p_tenant uuid,p_day_close uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.day_closes; m public.economic_maps; v jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.day_closes where tenant_id=p_tenant and id=p_day_close;
 if not found then raise exception 'DAY_CLOSE_NOT_FOUND'; end if;
 select * into m from public.economic_maps where tenant_id=p_tenant order by version desc limit 1;
 v:=komisio_private.economic_delta_preview(c,m);
 return (v-'targetVoucher')||jsonb_build_object('dayCloseId',c.id,'closeDate',c.close_date,'closeVersion',c.version,
  'mapId',m.id,'mapVersion',coalesce(m.version,0),'agreementNumber',m.agreement_number,'journalNumber',m.journal_number,
  'exportId',(select id from public.economic_exports where tenant_id=p_tenant and day_close_id=c.id and map_id=m.id
   and baseline_export_id is not distinct from (v->>'baselineExportId')::uuid));
end $$;

create or replace function public.export_economic_day_close(p_tenant uuid,p_id uuid,p_day_close uuid) returns uuid
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
 if not exists(select 1 from public.economic_connections where tenant_id=p_tenant and agreement_number=m.agreement_number) then raise exception 'ECONOMIC_WRONG_AGREEMENT'; end if;
 v:=komisio_private.economic_delta_preview(c,m);
 if v->>'blockedReason'<>'' then raise exception '%',v->>'blockedReason'; end if;
 select id into existing from public.economic_exports where tenant_id=p_tenant and day_close_id=c.id and map_id=m.id
  and baseline_export_id is not distinct from (v->>'baselineExportId')::uuid;
 if found then return existing; end if;
 if jsonb_array_length(v->'unmapped')>0 then raise exception 'ECONOMIC_MAP_INCOMPLETE'; end if;
 if not(v->>'balanced')::boolean then raise exception 'VOUCHER_UNBALANCED'; end if;
 insert into public.economic_exports(id,tenant_id,day_close_id,map_id,agreement_number,journal_number,voucher,excluded,debit_ore,credit_ore,created_by,baseline_export_id,target_voucher)
 values(p_id,p_tenant,c.id,m.id,m.agreement_number,m.journal_number,v->'lines',v->'excluded',(v->>'debitOre')::bigint,(v->>'creditOre')::bigint,uid,(v->>'baselineExportId')::uuid,v->'targetVoucher');
 perform komisio_private.record_access(p_tenant,'economic.exported',p_id,jsonb_build_object('day_close_id',c.id,'map_version',m.version,'baseline_export_id',v->'baselineExportId'));
 return p_id;
end $$;

create or replace function public.begin_economic_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.economic_connections; e public.economic_exports; s public.economic_sends; day public.day_closes; map public.economic_maps; v jsonb; frozen jsonb;
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
 select * into day from public.day_closes where tenant_id=p_tenant and id=e.day_close_id;
 select * into map from public.economic_maps where tenant_id=p_tenant and id=e.map_id;
 v:=komisio_private.economic_delta_preview(day,map);
 if v->>'blockedReason'='ECONOMIC_DAY_UNRESOLVED' then raise exception 'ECONOMIC_DAY_UNRESOLVED'; end if;
 if e.baseline_export_id is distinct from (v->>'baselineExportId')::uuid then raise exception 'ECONOMIC_BASELINE_CHANGED'; end if;
 if v->>'blockedReason'<>'' then raise exception '%',v->>'blockedReason'; end if;
 select jsonb_agg(l order by l->>'key',l->>'account',l->>'vatCode') into frozen from jsonb_array_elements(e.voucher) l;
 if frozen is distinct from v->'lines' then raise exception 'ECONOMIC_BASELINE_CHANGED'; end if;
 insert into public.economic_sends(id,tenant_id,export_id,agreement_number,journal_number,actor) values(p_id,p_tenant,p_export,c.agreement_number,e.journal_number,uid) returning * into s;
 return komisio_private.economic_send_state(s)||jsonb_build_object('dispatchAllowed',true);
end $$;

create or replace function public.economic_export_page(p_tenant uuid,p_export uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object(
   'day_closes',jsonb_build_object('close_date',c.close_date,'version',c.version),
   'economic_maps',jsonb_build_object('version',m.version),
   'baseline_export_id',e.baseline_export_id,'send',public.economic_send_status(p_tenant,e.id)) order by e.created_at desc),'[]')
  from (select * from public.economic_exports where tenant_id=p_tenant and (p_export is null or id=p_export) order by created_at desc limit 60) e
  join public.day_closes c on c.tenant_id=p_tenant and c.id=e.day_close_id
  join public.economic_maps m on m.tenant_id=p_tenant and m.id=e.map_id);
end $$;
