-- #561: immutable payment evidence and delivery differences. No historic row
-- is backfilled: unknown historic postings require reconciliation outside this flow.
alter table public.day_closes add column payout_sources jsonb
 check(payout_sources is null or jsonb_typeof(payout_sources)='array');
alter table public.fortnox_voucher_sends
 add column delta_voucher jsonb check(delta_voucher is null or jsonb_typeof(delta_voucher)='array'),
 add column baseline_send_id uuid,
 add constraint fortnox_send_tenant_id unique(tenant_id,id),
 add foreign key(tenant_id,baseline_send_id) references public.fortnox_voucher_sends(tenant_id,id);

create function komisio_private.paid_payout_sources(p_tenant uuid,p_date date) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('payoutId',id,'sellerId',seller_id,
  'amountOre',amount_ore,'reference',payment_reference,'paidAt',paid_at) order by id),'[]')
 from public.payouts where tenant_id=p_tenant and status='paid'
 and (paid_at at time zone 'Europe/Stockholm')::date=p_date
$$;
create function komisio_private.payout_evidence_complete(c public.day_closes) returns boolean
language sql immutable set search_path='' as $$
 select c.payouts_paid_ore=0 or (c.payout_sources is not null
  and c.payouts_paid_ore=(select coalesce(sum((p->>'amountOre')::bigint),0) from jsonb_array_elements(c.payout_sources) p))
$$;
create function komisio_private.additional_payout_sources(c public.day_closes,b public.day_closes) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(p order by p->>'payoutId'),'[]') from jsonb_array_elements(coalesce(c.payout_sources,'[]')) p
 where not exists(select 1 from jsonb_array_elements(coalesce(b.payout_sources,'[]')) old where old->>'payoutId'=p->>'payoutId')
$$;
revoke all on function komisio_private.paid_payout_sources(uuid,date),
 komisio_private.payout_evidence_complete(public.day_closes),
 komisio_private.additional_payout_sources(public.day_closes,public.day_closes) from public,anon,authenticated;

-- Preserve the current role, replay and automation rules verbatim. The existing
-- tenant lock also serializes payout confirmations with this source snapshot.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.generate_day_close(uuid,uuid,date)'::regprocedure);
 if position('per_mode,generated_by)' in definition)=0 or position('if same then return latest.id;' in definition)=0 then raise exception 'UNEXPECTED_DAY_CLOSE_FUNCTION'; end if;
 definition:=replace(definition,'if same then return latest.id;',
  'if same and komisio_private.payout_evidence_complete(latest) then return latest.id;');
 definition:=replace(definition,'per_mode,generated_by)','per_mode,generated_by,payout_sources)');
 definition:=replace(definition,'totals->''perMode'',uid);',
  'totals->''perMode'',uid,komisio_private.paid_payout_sources(p_tenant,p_date));');
 execute definition;
 -- Replays retain their frozen result; only creation of a new export is guarded.
 definition:=pg_get_functiondef('public.export_day_close(uuid,uuid,uuid)'::regprocedure);
 if position('v:=komisio_private.voucher_for(close,latest.map);' in definition)=0 then raise exception 'UNEXPECTED_ACCOUNTING_EXPORT_FUNCTION'; end if;
 execute replace(definition,'v:=komisio_private.voucher_for(close,latest.map);',
  'if not komisio_private.payout_evidence_complete(close) then raise exception ''ACCOUNTING_PAYOUT_HISTORY_REVIEW''; end if; v:=komisio_private.voucher_for(close,latest.map);');
end $$;

-- Wrap the existing economic delta calculation without changing its mapping,
-- agreement, pending-send or confirmed-baseline rules.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.economic_delta_preview(public.day_closes,public.economic_maps)'::regprocedure),
  'FUNCTION komisio_private.economic_delta_preview(', 'FUNCTION komisio_private.economic_delta_preview_before_payout_evidence(');
end $$;
revoke all on function komisio_private.economic_delta_preview_before_payout_evidence(public.day_closes,public.economic_maps) from public,anon,authenticated;
create or replace function komisio_private.economic_delta_preview(c public.day_closes,m public.economic_maps) returns jsonb
language plpgsql stable set search_path='' as $$
declare v jsonb; b public.day_closes; bm public.economic_maps;
begin
 v:=komisio_private.economic_delta_preview_before_payout_evidence(c,m);
 if v->>'baselineExportId' is not null then
  select d.* into b from public.economic_exports e join public.day_closes d on d.tenant_id=e.tenant_id and d.id=e.day_close_id
   where e.tenant_id=c.tenant_id and e.id=(v->>'baselineExportId')::uuid;
  select mp.* into bm from public.economic_exports e join public.economic_maps mp on mp.tenant_id=e.tenant_id and mp.id=e.map_id
   where e.tenant_id=c.tenant_id and e.id=(v->>'baselineExportId')::uuid;
 end if;
 if not komisio_private.payout_evidence_complete(c)
  or (b.id is not null and (not komisio_private.payout_evidence_complete(b)
   or (b.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(bm.map,true)))) then
  return v||jsonb_build_object('blockedReason','ACCOUNTING_PAYOUT_HISTORY_REVIEW','balanced',false,'lines','[]'::jsonb,'debitOre',0,'creditOre',0,'payoutSources','[]'::jsonb);
 end if;
 return v||jsonb_build_object('payoutSources',komisio_private.additional_payout_sources(c,b));
end $$;

create function komisio_private.fortnox_delta_preview(e public.accounting_exports) returns jsonb
language plpgsql stable set search_path='' as $$
declare c public.day_closes; b public.accounting_exports; bc public.day_closes;
 s public.fortnox_voucher_sends; baseline uuid; last_version integer:=0; next_version integer;
 connection public.fortnox_connections; m public.accounting_maps; bm public.accounting_maps;
 reason text:=''; lines jsonb; debit bigint; credit bigint;
begin
 select * into c from public.day_closes where tenant_id=e.tenant_id and id=e.day_close_id;
 select * into connection from public.fortnox_connections where tenant_id=e.tenant_id;
 select * into m from public.accounting_maps where tenant_id=e.tenant_id and id=e.map_id;
 if exists(select 1 from public.fortnox_voucher_sends fs
  join public.accounting_exports x on x.tenant_id=fs.tenant_id and x.id=fs.export_id
  join public.day_closes dc on dc.tenant_id=x.tenant_id and dc.id=x.day_close_id
  where fs.tenant_id=e.tenant_id and dc.close_date=c.close_date
   and (fs.status='pending' or (fs.status='failed' and fs.error_code not in ('FORTNOX_PREFLIGHT_FAILED','FORTNOX_WRONG_COMPANY')))) then
  reason:='FORTNOX_DAY_UNRESOLVED';
 else
  for s in select fs.* from public.fortnox_voucher_sends fs
   join public.accounting_exports x on x.tenant_id=fs.tenant_id and x.id=fs.export_id
   join public.day_closes dc on dc.tenant_id=x.tenant_id and dc.id=x.day_close_id
   where fs.tenant_id=e.tenant_id and dc.close_date=c.close_date and fs.status='sent'
   order by dc.version,fs.created_at,fs.id
  loop
   select x.* into b from public.accounting_exports x where x.tenant_id=e.tenant_id and x.id=s.export_id;
   select * into bc from public.day_closes where tenant_id=e.tenant_id and id=b.day_close_id;
   next_version:=bc.version;
   select * into bm from public.accounting_maps where tenant_id=e.tenant_id and id=b.map_id;
   if s.baseline_send_id is distinct from baseline or (baseline is not null and (s.delta_voucher is null or next_version<=last_version)) then
    reason:='FORTNOX_DAY_HISTORY_REVIEW'; exit;
   end if;
   if not komisio_private.payout_evidence_complete(bc) or (bc.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(bm.map)) then
    reason:='ACCOUNTING_PAYOUT_HISTORY_REVIEW'; exit;
   end if;
   if s.database_number is distinct from connection.database_number or bm.map is distinct from m.map then
    reason:='FORTNOX_DAY_CONTEXT_CHANGED'; exit;
   end if;
   baseline:=s.id; last_version:=next_version;
  end loop;
 end if;
 if reason='' and not komisio_private.payout_evidence_complete(c) then reason:='ACCOUNTING_PAYOUT_HISTORY_REVIEW'; end if;
 if reason='' and c.payouts_paid_ore<>0 and not komisio_private.payout_mapping_complete(m.map) then reason:='ACCOUNTING_PAYOUT_HISTORY_REVIEW'; end if;
 if reason='' and c.version<last_version then reason:='FORTNOX_BASELINE_CHANGED'; end if;
 if reason='' then
  with signed as (
   select l->>'key' k,l->>'account' account,(l->>'amountOre')::numeric*case when l->>'side'='debit' then 1 else -1 end amount from jsonb_array_elements(e.voucher) l
   union all
   select l->>'key',l->>'account',-(l->>'amountOre')::numeric*case when l->>'side'='debit' then 1 else -1 end from jsonb_array_elements(coalesce(b.voucher,'[]')) l
  ), net as (select k,account,sum(amount) amount from signed group by k,account having sum(amount)<>0)
  select coalesce(jsonb_agg(jsonb_build_object('key',k,'account',account,'side',case when amount>0 then 'debit' else 'credit' end,'amountOre',abs(amount)) order by k,account),'[]'),
   coalesce(sum(amount) filter(where amount>0),0)::bigint,coalesce(-sum(amount) filter(where amount<0),0)::bigint into lines,debit,credit from net;
  if debit=0 and credit=0 then reason:='FORTNOX_NO_CHANGES';
  elsif debit<>credit then reason:='VOUCHER_UNBALANCED'; end if;
 end if;
 return jsonb_build_object('baselineSendId',baseline,'baselineCloseVersion',last_version,'blockedReason',reason,
  'lines',coalesce(lines,'[]'),'debitOre',coalesce(debit,0),'creditOre',coalesce(credit,0),
  'payoutSources',komisio_private.additional_payout_sources(c,bc));
end $$;
revoke all on function komisio_private.fortnox_delta_preview(public.accounting_exports) from public,anon,authenticated;

create function public.preview_fortnox_send(p_tenant uuid,p_export uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.accounting_exports;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly')
  and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 return komisio_private.fortnox_delta_preview(e);
end $$;
revoke all on function public.preview_fortnox_send(uuid,uuid) from public,anon;
grant execute on function public.preview_fortnox_send(uuid,uuid) to authenticated;

-- Add a reviewed baseline argument, preserving the original authorization and
-- exact-request replay. Old three-argument callers remain valid for first sends.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.begin_fortnox_send(uuid,uuid,uuid)'::regprocedure);
 if position('insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,''pending'',uid);' in definition)=0 then raise exception 'UNEXPECTED_FORTNOX_BEGIN'; end if;
 definition:=replace(definition,'p_export uuid)', 'p_export uuid, p_expected_baseline uuid DEFAULT NULL)');
 definition:=replace(definition,'run public.access_events;', 'run public.access_events; preview jsonb;');
 definition:=replace(definition,
  'insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,''pending'',uid);',
  'preview:=komisio_private.fortnox_delta_preview(e);
   if preview->>''blockedReason''<>'''' then raise exception ''%'',preview->>''blockedReason''; end if;
   if p_expected_baseline is distinct from (preview->>''baselineSendId'')::uuid then raise exception ''FORTNOX_BASELINE_CHANGED''; end if;
   insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor,delta_voucher,baseline_send_id)
   values(p_id,p_tenant,p_export,c.database_number,''pending'',uid,preview->''lines'',p_expected_baseline);');
 drop function public.begin_fortnox_send(uuid,uuid,uuid);
 execute definition;
 definition:=pg_get_functiondef('komisio_private.guard_fortnox_send()'::regprocedure);
 execute replace(definition,'if new.id<>old.id', 'if new.delta_voucher is distinct from old.delta_voucher or new.baseline_send_id is distinct from old.baseline_send_id or new.id<>old.id');
end $$;
revoke all on function public.begin_fortnox_send(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.begin_fortnox_send(uuid,uuid,uuid,uuid) to authenticated;

create or replace function komisio_private.fortnox_send_state(s public.fortnox_voucher_sends) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sendId',s.id,'exportId',s.export_id,'status',s.status,'databaseNumber',s.database_number,
  'voucherSeries',s.voucher_series,'voucherNumber',s.voucher_number,'financialYear',s.financial_year,'errorCode',s.error_code,'detail',s.detail,
  'closeDate',d.close_date,'closeVersion',d.version,'lines',coalesce(s.delta_voucher,e.voucher),'baselineSendId',s.baseline_send_id,
  'debitOre',(select coalesce(sum((l->>'amountOre')::bigint),0) from jsonb_array_elements(coalesce(s.delta_voucher,e.voucher)) l where l->>'side'='debit'),
  'creditOre',(select coalesce(sum((l->>'amountOre')::bigint),0) from jsonb_array_elements(coalesce(s.delta_voucher,e.voucher)) l where l->>'side'='credit'),
  'payoutSources',komisio_private.additional_payout_sources(d,b))
 from public.accounting_exports e join public.day_closes d on d.tenant_id=e.tenant_id and d.id=e.day_close_id
 left join public.fortnox_voucher_sends bs on bs.tenant_id=s.tenant_id and bs.id=s.baseline_send_id
 left join public.accounting_exports be on be.tenant_id=s.tenant_id and be.id=bs.export_id
 left join public.day_closes b on b.tenant_id=s.tenant_id and b.id=be.day_close_id
 where e.tenant_id=s.tenant_id and e.id=s.export_id
$$;

-- Export detail reads expose the same immutable incremental payment evidence.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.economic_export_page(uuid,uuid)'::regprocedure);
 execute replace(definition,'''baseline_export_id'',e.baseline_export_id,',
  '''payout_sources'',komisio_private.additional_payout_sources(c,(select bc from public.economic_exports be join public.day_closes bc on bc.tenant_id=be.tenant_id and bc.id=be.day_close_id where be.tenant_id=e.tenant_id and be.id=e.baseline_export_id)),''baseline_export_id'',e.baseline_export_id,');
end $$;
