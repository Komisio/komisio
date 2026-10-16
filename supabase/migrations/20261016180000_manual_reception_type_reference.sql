-- Preserve a manual type observation even before the review is published (#478).
create or replace function komisio_private.catalogue_json_reference(doc jsonb, kind text, key text, names text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if jsonb_typeof(doc)='array' then
  for v in select value from jsonb_array_elements(doc) loop
   if komisio_private.catalogue_json_reference(v,kind,key,names) then return true; end if;
  end loop;
 elsif jsonb_typeof(doc)='object' then
  if kind='type' and doc->>'kind'='observation'
   and doc->>'reference'='komisio:manual-item-type:v1'
   and doc->>'observation'=key then return true; end if;
  if kind='attribute' and doc->>'slug'=key and (doc ? 'value' or doc ? 'definitionVersion') then return true; end if;
  if kind='category' and doc->>'slug'='category' and lower(trim(doc->>'value'))=any(names) then return true; end if;
  for k,v in select * from jsonb_each(doc) loop
   if kind='type' and k in ('itemType','item_type','typeSlug','type_slug') and v=to_jsonb(key) then return true; end if;
   if kind='group' and k in ('assortment','groupId','group_id','assortmentGroupId') and v=to_jsonb(key) then return true; end if;
   if kind='category' and k in ('category','suggestedCategory','suggested_category') and lower(trim(v#>>'{}'))=any(names) then return true; end if;
   if kind='attribute' and k=key then return true; end if;
   if komisio_private.catalogue_json_reference(v,kind,key,names) then return true; end if;
  end loop;
 end if;
 return false;
end $$;
revoke all on function komisio_private.catalogue_json_reference(jsonb,text,text,text[]) from public,anon,authenticated;
