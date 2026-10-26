-- #631: Configuration blockers are current readiness, never fabricated export outcomes.
create or replace function komisio_private.paypal_item_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.zettle_product_exports; o public.zettle_product_outcomes;
 s public.zettle_stock_outcomes; img text; state text; stage text; price_id uuid; config_id uuid; policy_id uuid; mode text; price_ore bigint; vat_map jsonb; blocked text;
begin
 stage:=komisio_private.item_lifecycle(p_tenant,p_item)->>'stage';
 select id into price_id from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 select id into config_id from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 policy_id:=(komisio_private.current_store_policy_core(p_tenant)->>'id')::uuid;
 select * into e from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 select * into o from public.zettle_product_outcomes where tenant_id=p_tenant and export_id=e.id order by created_at desc,id desc limit 1;
 select so.* into s from public.zettle_stock_intents si join public.zettle_stock_outcomes so on so.tenant_id=si.tenant_id and so.intent_id=si.id where si.tenant_id=p_tenant and si.item_id=p_item order by so.seq desc limit 1;
 select case when io.intent_id is not null then 'synced' when iu.intent_id is not null then 'uploaded' else 'held' end into img
 from public.zettle_image_intents ii
 left join public.zettle_image_uploads iu on iu.tenant_id=ii.tenant_id and iu.intent_id=ii.id
 left join public.zettle_image_outcomes io on io.tenant_id=ii.tenant_id and io.intent_id=ii.id
 where ii.tenant_id=p_tenant and ii.item_id=p_item order by ii.seq desc limit 1;
 state:=case
  when stage in ('sold','ended','period_ended') then 'inactive'
  when e.id is null then 'not_sent'
  when e.price_id is distinct from price_id or e.config_id is distinct from config_id or e.policy_version is distinct from policy_id or e.payload->>'name' is distinct from komisio_private.zettle_product_name(p_tenant,p_item) then 'changed'
  when o.status='failed' then 'failed'
  when o.status='synced' and s.status='initialized' then 'synced'
  else 'attention' end;
 -- Project only known configuration failures; unexpected errors must remain visible.
 -- Use the same facts as preparation, including store-margin fallback and business sellers.
 if stage in ('on_sale','markdown_due','period_ending') then
  select p.price_ore into price_ore from public.item_prices p where p.id=price_id and p.tenant_id=p_tenant;
  begin
   mode:=komisio_private.sale_line_facts(p_tenant,p_item,price_ore,komisio_private.current_store_policy_core(p_tenant)->'policy')->>'vatMode';
  exception when raise_exception then
   if sqlerrm='VAT_MODE_NOT_SET' then blocked:='VAT_MODE_NOT_SET'; else raise; end if;
  end;
  if blocked is null then
   select c.vat_map into vat_map from public.zettle_catalog_configs c where c.id=config_id and c.tenant_id=p_tenant;
   if vat_map->>mode is null then blocked:='ZETTLE_VAT_MAPPING_REQUIRED'; end if;
  end if;
 end if;
 if blocked is not null then state:='attention'; end if;
 return jsonb_build_object('itemId',p_item,'status',state,'productStatus',o.status,'productAt',o.created_at,
  'stockStatus',s.status,'stockAt',s.created_at,'imageStatus',img,'errorCode',coalesce(blocked,o.error_code,s.error_code),
  'canExport',blocked is null and stage in ('on_sale','markdown_due','period_ending'),
  'connected',exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant));
end $$;
revoke all on function komisio_private.paypal_item_snapshot(uuid,uuid) from public,anon,authenticated;
