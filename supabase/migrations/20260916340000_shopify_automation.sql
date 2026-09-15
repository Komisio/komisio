-- Scheduled Shopify order pull on the automation identity (owner decision
-- D1, scope shopify_pull): every quarter hour the identity pulls one page of
-- paid orders for stores whose owner enabled the scope, through the same
-- page function the button uses. The scope opens exactly what the pull
-- needs: the sealed connection (for the token), token renewal, the
-- watermark and page recording. Nothing else: no export, no check, no
-- disconnect. Runs are reserved per quarter hour so a duplicate cron
-- delivery never calls Shopify twice, and each run ends in one of three
-- fixed outcomes.
alter table public.automation_grants drop constraint automation_grants_scope_check;
alter table public.automation_grants add constraint automation_grants_scope_check check(scope in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull'));
create or replace function public.enable_automation(p_tenant uuid,p_id uuid,p_scope text,p_identity_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.automation_grants; address text:=lower(trim(p_identity_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_scope not in ('zettle_pull','fortnox_send','weekly_brief','shopify_pull') or address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.automation_grants where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.scope<>p_scope or prior.enabled_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.automation_grant_state(prior);
 end if;
 if exists(select 1 from public.automation_grants where tenant_id=p_tenant and scope=p_scope and disabled_at is null) then raise exception 'AUTOMATION_ALREADY_ENABLED'; end if;
 insert into public.automation_grants(id,tenant_id,scope,identity_email,enabled_by) values(p_id,p_tenant,p_scope,address,uid) returning * into prior;
 perform komisio_private.record_access(p_tenant,'automation.enabled',p_id,jsonb_build_object('scope',p_scope));
 return komisio_private.automation_grant_state(prior);
end $$;

create or replace function public.read_shopify_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.shopify_connections;
begin
 perform komisio_private.require_identity();
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.shopify_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('shopDomain',c.shop_domain,'shopName',c.shop_name,'currency',c.currency,'cipher',c.cipher,'scope',c.scope,'expiresAt',c.expires_at,'connectedAt',c.connected_at,'refreshedAt',c.refreshed_at,'revision',c.revision::text);
end $$;

create or replace function public.refresh_shopify_tokens(p_tenant uuid,p_revision bigint,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.shopify_connections; detail jsonb; next_revision bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_revision is null or p_revision<1 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data'])
  or length(coalesce(p_scope,''))>500 or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into connection from public.shopify_connections where tenant_id=p_tenant;
 if not found then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 if connection.revision<>p_revision then
  detail:=jsonb_build_object('reason','SHOPIFY_CONNECTION_CHANGED','expected_revision',p_revision::text,'current_revision',connection.revision::text);
  perform komisio_private.shopify_event(p_tenant,'refused',detail,actor);
  perform komisio_private.record_access(p_tenant,'shopify.refused',p_tenant,detail);
  return jsonb_build_object('error','SHOPIFY_CONNECTION_CHANGED');
 end if;
 next_revision:=nextval('komisio_private.fortnox_connection_revision');
 perform set_config('komisio.shopify_transition','engine',true);
 update public.shopify_connections set cipher=p_cipher,scope=coalesce(p_scope,connection.scope),expires_at=p_expires_at,refreshed_at=now(),revision=next_revision where tenant_id=p_tenant;
 perform set_config('komisio.shopify_transition','',true);
 perform komisio_private.shopify_event(p_tenant,'refreshed',jsonb_build_object('shop_domain',connection.shop_domain,'revision',next_revision::text),actor);
 return jsonb_build_object('status','refreshed','revision',next_revision::text);
end $$;

create or replace function public.shopify_order_cursor(p_tenant uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.shopify_watermark(p_tenant);
end $$;

create or replace function public.record_shopify_order_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_orders jsonb,p_accept_test boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.shopify_order_pulls; latest text; p jsonb; stored public.shopify_orders; line jsonb; lines jsonb; matches uuid[]; hold text; n integer; cur text:=komisio_private.store_currency(p_tenant);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin') or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.shopify_connections where tenant_id=p_tenant) then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 if p_id is null or p_orders is null or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)>50 or length(p_before)>100 or length(p_after)>100 or p_before='' or p_after='' then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.shopify_order_pulls where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.page is distinct from p_orders or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 latest:=komisio_private.shopify_watermark(p_tenant);
 if latest is distinct from p_before then raise exception 'SHOPIFY_CURSOR_CHANGED'; end if;
 n:=jsonb_array_length(p_orders);
 if (n>0 and p_after is null) or (n=0 and p_after is distinct from p_before) then raise exception 'INVALID_INPUT'; end if;
 for p in select * from jsonb_array_elements(p_orders) loop
  if not komisio_private.valid_shopify_order(p) then raise exception 'INVALID_INPUT'; end if;
  select * into stored from public.shopify_orders where tenant_id=p_tenant and order_gid=p->>'orderGid';
  if found then
   -- The same order again (a later page, or a replay): no new evidence. A changed order is held for a person.
   if stored.occurred_at is distinct from (p->>'occurredAt')::timestamptz or stored.amount_ore is distinct from (p->>'amountOre')::bigint or stored.currency is distinct from p->>'currency'
    or stored.cancelled is distinct from (p->>'cancelled')::boolean or stored.financial_status is distinct from p->>'financialStatus'
    or (select jsonb_agg(l-'itemId' order by (l->>'lineNo')::integer) from jsonb_array_elements(stored.lines) l) is distinct from p->'lines' then
    if not exists(select 1 from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=stored.id and error_code='SHOPIFY_ORDER_CHANGED') then
     insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,stored.id,null,'SHOPIFY_ORDER_CHANGED',uid);
    end if;
   end if;
   continue;
  end if;
  hold:=case when (p->>'test')::boolean and not coalesce(p_accept_test,false) then 'test' when (p->>'cancelled')::boolean then 'cancelled' when p->>'financialStatus'<>'PAID' then 'financial_status' when p->>'currency'<>cur then 'currency' end;
  lines:='[]'::jsonb;
  for line in select * from jsonb_array_elements(p->'lines') loop
   matches:=null;
   if line->>'sku' ~ '^K-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select array_agg(i.id) into matches from public.items i where i.tenant_id=p_tenant and i.id=substr(line->>'sku',3)::uuid;
   end if;
   if hold is null then
    hold:=case when (line->>'quantity')::integer<>1 then 'quantity' when line->'sku'='null'::jsonb or line->>'sku' !~ '^K-' then 'unknown_sku' when cardinality(matches)=0 or matches is null then 'missing_item' when cardinality(matches)>1 then 'ambiguous_item' end;
   end if;
   lines:=lines||(line||jsonb_build_object('itemId',case when cardinality(matches)=1 then matches[1] end));
  end loop;
  insert into public.shopify_orders(tenant_id,order_gid,name,occurred_at,updated_at,currency,amount_ore,financial_status,is_test,cancelled,hold_reason,lines,created_by)
   values(p_tenant,p->>'orderGid',p->>'name',(p->>'occurredAt')::timestamptz,(p->>'updatedAt')::timestamptz,p->>'currency',(p->>'amountOre')::bigint,p->>'financialStatus',(p->>'test')::boolean,(p->>'cancelled')::boolean,hold,lines,uid) returning * into stored;
  if hold is null then perform komisio_private.reconcile_shopify_order(p_tenant,stored.id); end if;
 end loop;
 insert into public.shopify_order_pulls(id,tenant_id,cursor_before,cursor_after,page,order_count,created_by) values(p_id,p_tenant,p_before,p_after,p_orders,n,uid);
 perform komisio_private.record_access(p_tenant,'shopify.orders_received',p_id,jsonb_build_object('orders',n,'cursor_after',p_after));
 return p_id;
end $$;

-- The private sale core admits the Shopify pull scope next to the Zettle one; the public record_sale is unchanged.
create or replace function komisio_private.record_sale_core(p_tenant uuid,p_id uuid,p_provider text,p_external_id text,p_occurred_at timestamptz,p_currency text,p_lines jsonb,p_reference jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.sales; pol jsonb; line jsonb; facts jsonb; computed jsonb:='[]'::jsonb; total bigint:=0; n integer:=0; ext text:=trim(p_external_id); existing_lines jsonb; line_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not (coalesce(public.tenant_role(p_tenant),'') in ('owner','admin','staff') or coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false) or coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_provider is null or p_provider not in ('manual','zettle','shopify') or ext is null or length(ext) not between 1 and 200
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '1 day' or p_currency is null
  or p_reference is null or jsonb_typeof(p_reference)<>'object' or not komisio_private.valid_sale_lines(p_lines) then raise exception 'INVALID_INPUT'; end if;
 if p_currency<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 select * into prior from public.sales where id=p_id;
 if not found then select * into prior from public.sales where tenant_id=p_tenant and provider=p_provider and external_id=ext; end if;
 if prior.id is not null then
  select coalesce(jsonb_agg(jsonb_build_object('itemId',l.item_id,'priceOre',l.price_ore) order by l.line_no),'[]'::jsonb) into existing_lines from public.sale_lines l where l.tenant_id=prior.tenant_id and l.sale_id=prior.id;
  if prior.tenant_id is distinct from p_tenant or prior.provider is distinct from p_provider or prior.external_id is distinct from ext
   or prior.occurred_at is distinct from p_occurred_at or existing_lines is distinct from p_lines then
   raise exception 'SALE_CONFLICT';
  end if;
  return prior.id;
 end if;
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 for line in select * from jsonb_array_elements(p_lines) loop
  n:=n+1;
  facts:=komisio_private.sale_line_facts(p_tenant,(line->>'itemId')::uuid,(line->>'priceOre')::bigint,pol);
  computed:=computed||(facts||jsonb_build_object('lineNo',n));
  total:=total+(facts->>'priceOre')::bigint;
 end loop;
 insert into public.sales(id,tenant_id,provider,external_id,currency,occurred_at,total_ore,provider_reference,recorded_by)
 values(p_id,p_tenant,p_provider,ext,p_currency,p_occurred_at,total,p_reference,uid);
 for facts in select * from jsonb_array_elements(computed) loop
  insert into public.sale_lines(tenant_id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,
   vat_mode,vat_rate_bp,vat_basis,vat_ore,agreement_version_id,seller_terms_version,store_policy_version)
  values(p_tenant,p_id,(facts->>'itemId')::uuid,(facts->>'lineNo')::integer,(facts->>'priceOre')::bigint,facts->>'ownership',facts->>'commissionBasis',(facts->>'commissionRatePercent')::numeric,
   (facts->>'commissionOre')::bigint,(facts->>'commissionVatOre')::bigint,(facts->>'sellerCreditOre')::bigint,
   facts->>'vatMode',(facts->>'vatRateBp')::integer,facts->'vatBasis',(facts->>'vatOre')::bigint,(facts->>'agreementVersionId')::uuid,(facts->>'sellerTermsVersion')::integer,(facts->>'storePolicyVersion')::integer)
  returning id into line_id;
  insert into public.item_events(tenant_id,item_id,kind,detail,actor) values(p_tenant,(facts->>'itemId')::uuid,'sold',jsonb_build_object('saleId',p_id,'lineNo',(facts->>'lineNo')::integer,'priceOre',(facts->>'priceOre')::bigint,'provider',p_provider),uid);
  if facts->>'ownership'='consignment' and (facts->>'sellerCreditOre')::bigint>0 then
   insert into public.seller_ledger_entries(id,tenant_id,seller_id,kind,amount_ore,reference_kind,reference_id,occurred_at,recorded_by)
   values(gen_random_uuid(),p_tenant,(facts->>'sellerId')::uuid,'credit_sale',(facts->>'sellerCreditOre')::bigint,'sale_line',line_id,p_occurred_at,uid);
  end if;
 end loop;
 perform komisio_private.record_access(p_tenant,'sale.recorded',p_id,jsonb_build_object('provider',p_provider,'external_id',ext,'lines',n,'total_ore',total,'currency',p_currency));
 return p_id;
end $$;

-- The sale is recorded through the private core: the callers (page recording, retry) already decided who may act.
create or replace function komisio_private.reconcile_shopify_order(p_tenant uuid,p_order uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); o public.shopify_orders; lines jsonb; result uuid; failure text; last public.shopify_order_outcomes;
begin
 select * into o from public.shopify_orders where tenant_id=p_tenant and id=p_order;
 if not found then raise exception 'SHOPIFY_ORDER_NOT_FOUND'; end if;
 if o.hold_reason is not null then raise exception 'SHOPIFY_ORDER_HELD'; end if;
 select jsonb_agg(jsonb_build_object('itemId',(l->>'itemId')::uuid,'priceOre',(l->>'priceOre')::bigint) order by (l->>'lineNo')::integer) into lines from jsonb_array_elements(o.lines) l;
 begin
  result:=komisio_private.record_sale_core(p_tenant,o.id,'shopify',o.order_gid,o.occurred_at,o.currency,lines,jsonb_build_object('shopifyOrderName',o.name,'shopifyOrderId',o.id));
 exception when others then
  failure:=case when sqlerrm ~ '^[A-Z_]{1,100}$' then sqlerrm else 'SHOPIFY_RECORD_FAILED' end;
 end;
 select * into last from public.shopify_order_outcomes where tenant_id=p_tenant and order_id=p_order order by seq desc limit 1;
 if last.sale_id is not distinct from result and last.error_code is not distinct from failure then return result; end if;
 insert into public.shopify_order_outcomes(tenant_id,order_id,sale_id,error_code,created_by) values(p_tenant,p_order,result,failure,uid);
 perform komisio_private.record_access(p_tenant,case when result is null then 'shopify.order_failed' else 'shopify.order_recorded' end,p_order,jsonb_build_object('sale_id',result,'error_code',failure,'order_gid',o.order_gid));
 return result;
end $$;

create function public.shopify_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return coalesce((select jsonb_agg(jsonb_build_object('tenantId',g.tenant_id)) from public.automation_grants g
  where g.scope='shopify_pull' and g.accepted_by=auth.uid() and g.disabled_at is null
  and komisio_private.automation_allowed(g.tenant_id,'shopify_pull')
  and exists(select 1 from public.shopify_connections c where c.tenant_id=g.tenant_id)),'[]'::jsonb);
end $$;

-- One reservation per store and quarter hour; null when this quarter hour already started.
create function public.prepare_shopify_automatic_pull(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); run_id uuid; mark text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.shopify_connections where tenant_id=p_tenant) then raise exception 'SHOPIFY_NOT_CONNECTED'; end if;
 run_id:=md5('shopify-cron:'||p_tenant::text||':'||floor(extract(epoch from clock_timestamp())/900)::text)::uuid;
 if exists(select 1 from public.access_events where tenant_id=p_tenant and action='shopify.automatic_started' and target_id=run_id) then return null; end if;
 mark:=komisio_private.shopify_watermark(p_tenant);
 perform komisio_private.record_access(p_tenant,'shopify.automatic_started',run_id,jsonb_build_object('cursor',mark));
 return jsonb_build_object('id',run_id,'cursor',mark);
end $$;

-- The outcome must agree with what was recorded: a page with orders, an empty page, or no page at all.
create function public.finish_shopify_automatic_pull(p_tenant uuid,p_id uuid,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); started public.access_events; outcome text; n integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'shopify_pull'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_outcome is null or p_outcome not in ('received','complete','failed') then raise exception 'INVALID_INPUT'; end if;
 select * into started from public.access_events where tenant_id=p_tenant and target_id=p_id and action='shopify.automatic_started' and actor_id=actor order by id limit 1;
 if not found then raise exception 'REQUEST_CONFLICT'; end if;
 select order_count into n from public.shopify_order_pulls where tenant_id=p_tenant and id=p_id and created_by=actor;
 outcome:=case when n>0 then 'received' when n=0 then 'complete' else 'failed' end;
 if p_outcome is distinct from outcome then raise exception 'REQUEST_CONFLICT'; end if;
 if exists(select 1 from public.access_events where tenant_id=p_tenant and target_id=p_id and action='shopify.automatic_finished') then return; end if;
 perform komisio_private.record_access(p_tenant,'shopify.automatic_finished',p_id,jsonb_build_object('outcome',outcome,'received',coalesce(n,0)));
end $$;

create function public.shopify_automatic_pull_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare started public.access_events; finished public.access_events;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into started from public.access_events where tenant_id=p_tenant and action='shopify.automatic_started' order by id desc limit 1;
 if not found then return null; end if;
 select * into finished from public.access_events where tenant_id=p_tenant and action='shopify.automatic_finished' and target_id=started.target_id order by id desc limit 1;
 return jsonb_build_object('id',started.target_id,'at',started.occurred_at,'outcome',coalesce(finished.detail->>'outcome','started'),'received',coalesce((finished.detail->>'received')::integer,0));
end $$;
revoke all on function public.shopify_automation_tenants(),public.prepare_shopify_automatic_pull(uuid),public.finish_shopify_automatic_pull(uuid,uuid,text),public.shopify_automatic_pull_status(uuid) from public,anon;
grant execute on function public.shopify_automation_tenants(),public.prepare_shopify_automatic_pull(uuid),public.finish_shopify_automatic_pull(uuid,uuid,text),public.shopify_automatic_pull_status(uuid) to authenticated;
