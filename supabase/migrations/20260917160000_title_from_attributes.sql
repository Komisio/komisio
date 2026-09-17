-- The descriptive reads go through the attribute list (2026-09-17, first step
-- of retiring the seven fixed keys). item_title branched on origin and read
-- three fields out of whichever shape it found. It now asks item_attributes,
-- which already knows how to answer for a reception, an inspection and a
-- purchase, and which overlays corrections.
--
-- Two things follow that are improvements rather than side effects. A category
-- corrected after acceptance now groups the stock report under the corrected
-- value, and a corrected title is what the item list shows, because both read
-- through here. Before this, a correction was invisible to every report.
--
-- The four callers (price evidence, the items overview, the stock report and
-- the chain transfer) are untouched: the shape they read is the same.
create or replace function komisio_private.item_title(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare attrs jsonb;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then
  return jsonb_build_object('title',null,'category',null,'condition',null);
 end if;
 attrs:=komisio_private.item_attributes(p_tenant,p_item);
 return jsonb_build_object(
  'title',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='description' limit 1),
  'category',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='category' limit 1),
  'condition',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='condition' limit 1));
end $$;
