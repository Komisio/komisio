-- Defaults belong to initial store creation, in the same engine transaction.
-- Existing stores keep their vocabulary; retries do not fire this insert trigger.
create function komisio_private.seed_store_vocabulary() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Keep shared core/base definitions and their translations. Shadow the old
 -- example-only fields without deleting platform definitions or observations.
 insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help,active)
 select distinct on (d.slug) new.id,d.slug,d.version,d.data_type,d.unit,d.choices,d.labels,d.help,false
 from public.attribute_definitions d
 where d.tenant_id is null and d.slug in ('fit','height_cm','socket','max_wattage','dimmable')
 order by d.slug,d.version desc;

 insert into public.item_types(tenant_id,slug,labels,suggested_category,active)
 select new.id,t.slug,t.labels,t.suggested_category,false
 from public.item_types t where t.tenant_id is null and t.slug in ('sweater','lamp');
 -- Keep legacy profiles readable while excluding them from active selectors.
 insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
 select new.id,a.type_slug,a.attribute_slug,a.expected,a.sort
 from public.item_type_attributes a where a.tenant_id is null and a.type_slug in ('sweater','lamp');

 insert into public.item_types(tenant_id,slug,labels) values
 (new.id,'jacket','{"sv":"Jacka","en":"Jacket","no":"Jakke","dk":"Jakke","fi":"Takki","de":"Jacke","es":"Chaqueta","it":"Giacca"}'),
 (new.id,'trousers','{"sv":"Byxor","en":"Trousers","no":"Bukser","dk":"Bukser","fi":"Housut","de":"Hose","es":"Pantalones","it":"Pantaloni"}');
 insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
 select new.id,t.slug,a.slug,a.slug='description',a.sort
 from (values ('jacket'),('trousers')) t(slug)
 cross join (values ('category',0),('description',1),('size',2),('color',3),('brand',4),('material',5),('condition',6)) a(slug,sort);
 return new;
end $$;
revoke all on function komisio_private.seed_store_vocabulary() from public,anon,authenticated;
create trigger seed_store_vocabulary after insert on public.tenants
 for each row execute function komisio_private.seed_store_vocabulary();
