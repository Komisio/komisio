-- Scope expiry to the designated central tenant and an explicitly granted worker.
alter table public.automation_grants drop constraint automation_grants_scope_check;
alter table public.automation_grants add constraint automation_grants_scope_check check(scope in
 ('zettle_pull','fortnox_send','weekly_brief','shopify_pull','day_close','catalog_export','central_guarantees'));
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('public.enable_automation(uuid,uuid,text,text)'::regprocedure);
 needle:='''day_close'',''catalog_export''';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_AUTOMATION_SCOPES'; end if;
 d:=replace(d,needle,needle||',''central_guarantees''');
 needle:='select * into prior from public.automation_grants where id=p_id;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_AUTOMATION_GRANT'; end if;
 execute replace(d,needle,'if p_scope=''central_guarantees'' and not exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant)
  then raise exception ''FORBIDDEN'' using errcode=''42501''; end if; '||needle);
end $$;

create function public.central_guarantee_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return coalesce((select jsonb_agg(jsonb_build_object('tenantId',p.central_app_tenant_id)) from public.platform_settings p
  where coalesce(komisio_private.automation_allowed(p.central_app_tenant_id,'central_guarantees'),false)),'[]'::jsonb);
end $$;

create function public.run_central_guarantees(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g record; processed integer:=0; at_time timestamptz:=clock_timestamp(); more boolean;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if not exists(select 1 from public.platform_settings where central_app_tenant_id=p_tenant)
  or not(coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff')
    or coalesce(komisio_private.automation_allowed(p_tenant,'central_guarantees'),false))
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.require_writable(p_tenant);
 for g in select x.id from public.external_item_guarantees x where x.tenant_id=p_tenant and x.due_at<=at_time
  and not exists(select 1 from public.external_item_guarantee_events e where e.guarantee_id=x.id and e.kind='credited')
  order by x.due_at,x.id limit 100
 loop
  if komisio_private.fulfill_due_guarantee(p_tenant,g.id,at_time) then processed:=processed+1; end if;
 end loop;
 select exists(select 1 from public.external_item_guarantees x where x.tenant_id=p_tenant and x.due_at<=at_time
  and not exists(select 1 from public.external_item_guarantee_events e where e.guarantee_id=x.id and e.kind='credited')) into more;
 return jsonb_build_object('processed',processed,'more',more);
end $$;
revoke all on function public.central_guarantee_automation_tenants(),public.run_central_guarantees(uuid) from public,anon,authenticated;
grant execute on function public.central_guarantee_automation_tenants(),public.run_central_guarantees(uuid) to authenticated;

-- A sale after the deadline first fulfills the already-due acquisition, even
-- when a worker was delayed. A late imported pre-deadline sale retains its date.
create function komisio_private.prepare_guaranteed_sale(p_tenant uuid,p_item uuid,p_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare g public.external_item_guarantees; gid uuid;
begin
 select (terms#>>'{externalGuarantee,id}')::uuid into gid from public.items where tenant_id=p_tenant and id=p_item;
 if gid is null then return; end if;
 g:=komisio_private.central_guarantee(p_tenant,gid);
 if p_at<g.received_at or p_at>clock_timestamp() then raise exception 'INVALID_INPUT'; end if;
 if p_at>=g.due_at then perform komisio_private.fulfill_due_guarantee(p_tenant,g.id,clock_timestamp()); end if;
end $$;
revoke all on function komisio_private.prepare_guaranteed_sale(uuid,uuid,timestamptz) from public,anon,authenticated;
do $$ declare d text; needle text:='facts:=komisio_private.sale_line_facts(p_tenant,(line->>''itemId'')::uuid,(line->>''priceOre'')::bigint,pol);'; begin
 d:=pg_get_functiondef('komisio_private.record_sale_core(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SALE_PREPARATION'; end if;
 execute replace(d,needle,'perform komisio_private.prepare_guaranteed_sale(p_tenant,(line->>''itemId'')::uuid,p_occurred_at); '||needle);
end $$;

create function komisio_private.require_guarantee_accounting_ready(p_tenant uuid,p_through date) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 -- Conservative until accounting has an append-only resolution model: later
 -- payouts/returns can depend on an earlier outstanding guarantee credit.
 if exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and l.accounting_pending and s.occurred_at<((p_through+1)::timestamp at time zone 'Europe/Stockholm'))
 or exists(select 1 from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.kind='credit_guarantee'
  and e.occurred_at<((p_through+1)::timestamp at time zone 'Europe/Stockholm'))
 then raise exception 'GUARANTEE_ACCOUNTING_PENDING'; end if;
end $$;
revoke all on function komisio_private.require_guarantee_accounting_ready(uuid,date) from public,anon,authenticated;
do $$ declare d text; needle text; signature text; begin
 d:=pg_get_functiondef('public.generate_day_close(uuid,uuid,date)'::regprocedure);
 needle:='totals:=komisio_private.day_close_totals(p_tenant,p_date);';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_DAY_CLOSE_TOTALS'; end if;
 execute replace(d,needle,'perform komisio_private.require_guarantee_accounting_ready(p_tenant,p_date); '||needle);
 foreach signature in array array['public.export_day_close(uuid,uuid,uuid)','public.export_economic_day_close(uuid,uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:='select * into prior from';
  if position(needle in d)=0 then raise exception 'UNEXPECTED_ACCOUNTING_EXPORT'; end if;
  execute replace(d,needle,'perform komisio_private.require_guarantee_accounting_ready(p_tenant,(select close_date from public.day_closes where tenant_id=p_tenant and id=p_day_close)); '||needle);
 end loop;
end $$;

-- Snapshot ownership is historical. Read models expose the subsequent
-- acquisition/return without rewriting the original consignment evidence.
do $$ declare d text; signature text; begin
 foreach signature in array array['public.items_search_page(uuid,jsonb,text,text,integer,integer)',
  'public.stock_lifecycle_report(uuid,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('i.ownership' in d)=0 then raise exception 'UNEXPECTED_OWNERSHIP_READ'; end if;
  d:=replace(d,'select i.id,i.origin_kind,i.seller_id,i.ownership,','select i.id,i.origin_kind,i.seller_id,komisio_private.item_operational_ownership(i.tenant_id,i.id) as ownership,');
  d:=replace(d,'select i.ownership,','select komisio_private.item_operational_ownership(i.tenant_id,i.id) as ownership,');
  d:=replace(d,'i.ownership','komisio_private.item_operational_ownership(i.tenant_id,i.id)');
  execute d;
 end loop;
 d:=pg_get_functiondef('public.item_detail(uuid,uuid)'::regprocedure);
 if position('''ownership'',it.ownership' in d)=0 then raise exception 'UNEXPECTED_ITEM_DETAIL'; end if;
 execute replace(d,'''ownership'',it.ownership','''ownership'',komisio_private.item_operational_ownership(p_tenant,p_item)');
 d:=pg_get_functiondef('komisio_private.item_lifecycle(uuid,uuid)'::regprocedure);
 if position('when g.due_at<=now() then ''period_ended''' in d)=0 then raise exception 'UNEXPECTED_GUARANTEE_LIFECYCLE'; end if;
 d:=replace(d,'when g.due_at<=now() then ''period_ended''','when komisio_private.item_operational_ownership(p_tenant,p_item)=''store'' then ''on_sale'' when g.due_at<=now() then ''period_ended''');
 execute d;
end $$;
