-- New descriptive snapshots retain the existing remote product and one-shot stock intent.
alter table public.zettle_product_exports add column content_version integer not null default 0 check(content_version>=0);
drop index public.zettle_export_snapshot;
create unique index zettle_export_snapshot on public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,content_version) nulls not distinct;

create function komisio_private.zettle_product_name(p_tenant uuid,p_item uuid) returns text
language sql stable security definer set search_path='' as $$
 select left(coalesce(nullif(trim(komisio_private.item_title(p_tenant,p_item)->>'title'),''),'Item I-'||upper(left(p_item::text,8))),120)
$$;
revoke all on function komisio_private.zettle_product_name(uuid,uuid) from public,anon,authenticated;

create or replace function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;policy_id uuid; content_revision integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') and not public.catalog_export_item_access(p_tenant,p_item) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 policy_id:=(komisio_private.current_store_policy_core(p_tenant)->>'id')::uuid;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,komisio_private.current_store_policy_core(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 title:=komisio_private.zettle_product_name(p_tenant,p_item);
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 if found and prior.price_id=price.id and prior.config_id=cfg.id and prior.policy_version is not distinct from policy_id and prior.payload->>'name'=title then return prior.id;end if;
 pid:=coalesce(prior.product_id,extensions.uuid_generate_v1mc());vid:=coalesce(prior.variant_id,extensions.uuid_generate_v1mc());
 if (select count(*) from public.items where tenant_id=p_tenant and left(id::text,8)=left(p_item::text,8))<>1 then raise exception 'ZETTLE_LABEL_AMBIGUOUS';end if;
 select coalesce(max(content_version),-1)+1 into content_revision from public.zettle_product_exports
 where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id and policy_version is not distinct from policy_id and product_id=pid;
 body:=jsonb_build_object('uuid',pid,'name',title,'externalReference','komisio:'||p_item,'vatPercentage',vat,'variants',jsonb_build_array(jsonb_build_object('uuid',vid,'sku','K-'||p_item,'barcode','I-'||upper(left(p_item::text,8)),'price',jsonb_build_object('amount',price.price_ore,'currencyId',komisio_private.store_currency(p_tenant)))));
 select e.payload into previous from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=p_item order by o.created_at desc limit 1;
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by,content_version) values(p_tenant,p_item,price.id,cfg.id,policy_id,pid,vid,body,previous,uid,content_revision) returning id into result;
 return result;
end $$;

create or replace function komisio_private.paypal_item_snapshot(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.zettle_product_exports; o public.zettle_product_outcomes;
 s public.zettle_stock_outcomes; img text; state text; stage text; price_id uuid; config_id uuid; policy_id uuid;
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
 return jsonb_build_object('itemId',p_item,'status',state,'productStatus',o.status,'productAt',o.created_at,
  'stockStatus',s.status,'stockAt',s.created_at,'imageStatus',img,'errorCode',coalesce(o.error_code,s.error_code),
  'canExport',stage in ('on_sale','markdown_due','period_ending'),
  'connected',exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant));
end $$;
revoke all on function komisio_private.paypal_item_snapshot(uuid,uuid) from public,anon,authenticated;


create or replace function public.zettle_catalog_candidates(p_tenant uuid) returns table(item_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select i.id from public.items i
 join lateral(select p.id from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by set_at desc,seq desc limit 1) p on true
 left join lateral(select c.id from public.zettle_catalog_configs c where c.tenant_id=p_tenant order by revision desc limit 1)c on true
 where i.tenant_id=p_tenant and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'sold')::boolean and not (komisio_private.item_lifecycle(p_tenant,i.id)->>'ended')::boolean
 and not exists(select 1 from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=i.id and e.price_id=p.id and e.config_id=c.id and e.policy_version is not distinct from (public.current_store_policy(p_tenant)->>'id')::uuid and e.payload->>'name'=komisio_private.zettle_product_name(p_tenant,i.id) and e.id=(select latest.id from public.zettle_product_exports latest where latest.tenant_id=p_tenant and latest.item_id=i.id order by latest.created_at desc,latest.id desc limit 1))
 order by i.accepted_at,i.id limit 20;
end $$;
