-- #732: repair existing translated-name collisions without erasing history.
CREATE OR REPLACE FUNCTION public.update_item_type(p_tenant uuid, p_slug text, p_expected jsonb, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur jsonb; desired jsonb; category uuid; category_name text;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select t into cur from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug;
 if cur is null then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 if p_payload ? 'suggestedCategoryId' then
  begin category:=(p_payload->>'suggestedCategoryId')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  select name into category_name from komisio_private.current_item_categories where tenant_id=p_tenant and id=category;
 else
  select m.category_id into category from komisio_private.category_match(p_tenant,p_payload->>'suggestedCategory') m;
  category_name:=p_payload->>'suggestedCategory';
 end if;
 desired:=jsonb_build_object('labels',p_payload->'labels','suggested_category',coalesce(category_name,''),'suggested_category_id',category,'active',p_payload->'active','attributes',p_payload->'attributes','inherit_attributes',coalesce(p_payload->'inheritAttributes','false'::jsonb));
 if cur is distinct from (jsonb_build_object('suggested_category_id',null,'inherit_attributes',cur->'inherit_attributes')||p_expected) then
  if (cur-array['slug','own'])=desired then return cur; end if;
  raise exception 'CATALOGUE_CHANGED';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->'labels'='{}' or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t
  cross join lateral jsonb_each_text(t->'labels') l cross join lateral jsonb_each_text(p_payload->'labels') n
  where t->>'slug'<>p_slug and lower(trim(l.value))=lower(trim(n.value))
   -- Existing collisions must not prevent repair or retirement. A changed
   -- translation or reactivation may not introduce a conflicting choice.
   and (lower(trim(cur->'labels'->>n.key)) is distinct from lower(trim(n.value))
    or (not (cur->>'active')::boolean and (p_payload->>'active')::boolean))) then raise exception 'ITEM_TYPE_NAME_EXISTS'; end if;
 perform public.set_item_type(p_tenant,p_slug,p_payload);
 return (select t from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug);
end $function$;
