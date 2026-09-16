-- Detail reads as engine functions (2026-09-16, Opus). The hosted connector
-- routes every tool call through connector_call, which reaches SQL functions
-- and nothing else, so the reads that went straight to tables were unavailable
-- to a store's own assistant: one item, one receipt, a receipt list, a seller's
-- ledger and the day closes. Moving them here changes nothing for the web,
-- which read the same rows under the same policies, and lets the connector
-- answer the questions a store actually asks. Each function checks the
-- caller's store role exactly as the row-level policies did, and returns the
-- same field names the application already parses.
create function public.item_detail(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare it public.items;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into it from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return null; end if;
 return jsonb_build_object(
  'item',jsonb_build_object('id',it.id,'origin_kind',it.origin_kind,'origin_id',it.origin_id,'origin_revision',it.origin_revision,
   'custody_kind',it.custody_kind,'custody_id',it.custody_id,'seller_id',it.seller_id,'ownership',it.ownership,'terms',it.terms,'accepted_at',it.accepted_at),
  'prices',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'price_ore',p.price_ore,'reason',p.reason,'set_at',p.set_at) order by p.set_at desc,p.seq desc)
   from public.item_prices p where p.tenant_id=p_tenant and p.item_id=p_item),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'detail',e.detail,'occurred_at',e.occurred_at) order by e.occurred_at)
   from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item),'[]'::jsonb));
end $$;

create function public.sales_page(p_tenant uuid,p_provider text,p_external_id text,p_status text,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_at desc,r.id) from (
   select s.id,s.provider,s.external_id,s.currency,s.occurred_at,s.total_ore,s.status,s.recorded_at
   from public.sales s
   where s.tenant_id=p_tenant
    and (p_provider is null or s.provider=p_provider)
    and (p_external_id is null or s.external_id=p_external_id)
    and (p_status is null or s.status=p_status)
   order by s.occurred_at desc,s.id limit p_limit) r),'[]'::jsonb);
end $$;

create function public.sale_detail(p_tenant uuid,p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sale jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select to_jsonb(r) into sale from (
  select s.id,s.provider,s.external_id,s.currency,s.occurred_at,s.total_ore,s.status,s.recorded_at
  from public.sales s where s.tenant_id=p_tenant and s.id=p_sale) r;
 if sale is null then return null; end if;
 return jsonb_build_object('sale',sale,'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from (
   select x.id,x.sale_id,x.item_id,x.line_no,x.price_ore,x.ownership,x.commission_basis,x.commission_rate_percent,
    x.commission_ore,x.commission_vat_ore,x.seller_credit_ore,x.vat_mode,x.vat_rate_bp,x.vat_ore
   from public.sale_lines x where x.tenant_id=p_tenant and x.sale_id=p_sale) l),'[]'::jsonb));
end $$;

create function public.seller_ledger_page(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_at desc,r.id) from (
   select e.id,e.kind,e.amount_ore,e.reference_kind,e.reference_id,e.reason,e.occurred_at
   from public.seller_ledger_entries e where e.tenant_id=p_tenant and e.seller_id=p_seller
   order by e.occurred_at desc,e.id limit 50) r),'[]'::jsonb);
end $$;

create function public.day_close_page(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.close_date desc,r.version desc) from (
   select d.id,d.close_date,d.version,d.sales_count,d.returns_count,d.gross_ore,d.vat_ore,d.commission_ore,
    d.commission_vat_ore,d.seller_credit_ore,d.refunds_ore,d.credit_reversed_ore,d.payouts_paid_ore,d.per_mode,d.generated_at
   from public.day_closes d where d.tenant_id=p_tenant
   order by d.close_date desc,d.version desc limit 60) r),'[]'::jsonb);
end $$;

revoke all on function public.item_detail(uuid,uuid),public.sales_page(uuid,text,text,text,integer),public.sale_detail(uuid,uuid),
 public.seller_ledger_page(uuid,uuid),public.day_close_page(uuid) from public,anon,authenticated;
grant execute on function public.item_detail(uuid,uuid),public.sales_page(uuid,text,text,text,integer),public.sale_detail(uuid,uuid),
 public.seller_ledger_page(uuid,uuid),public.day_close_page(uuid) to authenticated;

-- The connector may call them under the scope that already covers each read.
insert into public.connector_functions(function_name,scope,kind) values
 ('item_detail','items:read',''),
 ('sales_page','sales:read',''),
 ('sale_detail','sales:read',''),
 ('seller_ledger_page','economy:read',''),
 ('day_close_page','accounting:read','');
