-- Store creation seeded tenant-scoped profiles too. Preserve every explicitly
-- edited type, but let untouched starter profiles follow store registration fields.
update public.item_types t set inherit_attributes=true
where t.tenant_id is not null and t.created_by is null
 and t.slug in ('jacket','trousers','sweater','lamp')
 and not exists(select 1 from public.access_events e where e.tenant_id=t.tenant_id
   and e.action='item_type.set' and e.detail->>'slug'=t.slug);
