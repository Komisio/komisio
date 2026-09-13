-- Append-only recovery of provider-rejected v4 product identities.
alter table public.zettle_product_exports add column supersedes_export_id uuid;
alter table public.zettle_product_exports add constraint zettle_export_predecessor foreign key(tenant_id,supersedes_export_id) references public.zettle_product_exports(tenant_id,id);
create unique index zettle_export_successor on public.zettle_product_exports(supersedes_export_id) where supersedes_export_id is not null;
drop index public.zettle_export_snapshot;
create unique index zettle_export_snapshot on public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id) nulls not distinct;
create or replace function public.prepare_zettle_product(p_tenant uuid,p_item uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();item public.items;price public.item_prices;cfg public.zettle_catalog_configs;prior public.zettle_product_exports;pid uuid;vid uuid;body jsonb;previous jsonb;title text;mode text;vat numeric;result uuid;policy_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND';end if;
 select * into price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,seq desc limit 1;
 policy_id:=(public.current_store_policy(p_tenant)->>'id')::uuid;
 mode:=komisio_private.sale_line_facts(p_tenant,p_item,price.price_ore,public.current_store_policy(p_tenant)->'policy')->>'vatMode';
 select * into cfg from public.zettle_catalog_configs where tenant_id=p_tenant order by revision desc limit 1;
 vat:=(cfg.vat_map->>mode)::numeric;
 if vat is null then raise exception 'ZETTLE_VAT_MAPPING_REQUIRED';end if;
 select * into prior from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item and price_id=price.id and config_id=cfg.id and policy_version is not distinct from policy_id order by created_at desc,id desc limit 1;
 if found then return prior.id;end if;
 select product_id,variant_id into pid,vid from public.zettle_product_exports where tenant_id=p_tenant and item_id=p_item order by created_at desc,id desc limit 1;
 pid:=coalesce(pid,extensions.uuid_generate_v1mc());vid:=coalesce(vid,extensions.uuid_generate_v1mc());
 if (select count(*) from public.items where tenant_id=p_tenant and left(id::text,8)=left(p_item::text,8))<>1 then raise exception 'ZETTLE_LABEL_AMBIGUOUS';end if;
 if item.origin_kind='inspection_draft' then
  select description into title from public.inspection_draft_revisions where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
 elsif item.origin_kind='reception_review' then
  select suggestions->'metadata'->'description'->>'value' into title from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 else title:='Item I-'||upper(left(p_item::text,8));end if;
 body:=jsonb_build_object('uuid',pid,'name',left(coalesce(nullif(title,''),'Item I-'||upper(left(p_item::text,8))),120),'externalReference','komisio:'||p_item,'vatPercentage',vat,'variants',jsonb_build_array(jsonb_build_object('uuid',vid,'sku','K-'||p_item,'barcode','I-'||upper(left(p_item::text,8)),'price',jsonb_build_object('amount',price.price_ore,'currencyId','SEK'))));
 select e.payload into previous from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id and o.status='synced' where e.tenant_id=p_tenant and e.item_id=p_item order by o.created_at desc limit 1;
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by) values(p_tenant,p_item,price.id,cfg.id,policy_id,pid,vid,body,previous,uid) returning id into result;
 return result;
end $$;

create function public.repair_zettle_product_identity(p_tenant uuid,p_export uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); old public.zettle_product_exports; successor uuid; pid uuid; vid uuid; body jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into old from public.zettle_product_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'ZETTLE_EXPORT_NOT_FOUND';end if;
 select id into successor from public.zettle_product_exports where tenant_id=p_tenant and supersedes_export_id=p_export;
 if found then return successor;end if;
 if substring(old.product_id::text,15,1)<>'4' or old.previous_payload is not null
 or not exists(select 1 from public.zettle_product_outcomes where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code='ZETTLE_PRODUCT_UUID_REJECTED')
 or exists(select 1 from public.zettle_product_exports e join public.zettle_product_outcomes o on o.tenant_id=e.tenant_id and o.export_id=e.id where e.tenant_id=p_tenant and e.item_id=old.item_id and o.status='synced')
 or exists(select 1 from public.zettle_stock_intents where tenant_id=p_tenant and item_id=old.item_id)
 then raise exception 'ZETTLE_IDENTITY_HELD';end if;
 -- Also rechecks saleability, latest price and policy, under the same tenant lock.
 if public.prepare_zettle_product(p_tenant,old.item_id)<>p_export then raise exception 'ZETTLE_EXPORT_STALE';end if;
 pid:=extensions.uuid_generate_v1mc();vid:=extensions.uuid_generate_v1mc();
 body:=jsonb_set(jsonb_set(old.payload,'{uuid}',to_jsonb(pid)),'{variants,0,uuid}',to_jsonb(vid));
 insert into public.zettle_product_exports(tenant_id,item_id,price_id,config_id,policy_version,product_id,variant_id,payload,previous_payload,created_by,supersedes_export_id)
 values(p_tenant,old.item_id,old.price_id,old.config_id,old.policy_version,pid,vid,body,null,uid,p_export) returning id into successor;
 return successor;
end $$;
revoke all on function public.repair_zettle_product_identity(uuid,uuid) from public,anon;
grant execute on function public.repair_zettle_product_identity(uuid,uuid) to authenticated;
