-- Create-only adapter for reception: retain the existing owner/admin boundary.
-- Lock the same tenant row as set_item_type so a replay cannot undo a later edit.
create function public.create_item_type(p_tenant uuid,p_id uuid,p_name text,p_locale text,p_attributes jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); v_slug text; names jsonb; attrs jsonb; prior public.item_types; prior_attrs jsonb; vocabulary jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120
  or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
  or p_attributes is null or jsonb_typeof(p_attributes)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_attributes) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from jsonb_array_elements(p_attributes) a where jsonb_typeof(a)<>'object'
  or not(a ?& array['slug','expected','sort']) or (a-array['slug','expected','sort'])<>'{}'::jsonb
  or jsonb_typeof(a->'slug')<>'string' or a->>'slug' !~ '^[a-z][a-z0-9_]{0,39}$'
  or jsonb_typeof(a->'expected')<>'boolean' or jsonb_typeof(a->'sort')<>'number'
  or a->>'sort' !~ '^[0-9]{1,4}$') then raise exception 'INVALID_INPUT'; end if;
 if (select count(distinct a->>'slug') from jsonb_array_elements(p_attributes) a)<>jsonb_array_length(p_attributes)
  or not(p_attributes @> '[{"slug":"description"}]'::jsonb) then raise exception 'INVALID_INPUT'; end if;
 select jsonb_agg(a order by (a->>'sort')::integer,a->>'slug') into attrs from jsonb_array_elements(p_attributes) a;
 v_slug:='custom_'||replace(p_id::text,'-','');
 names:=jsonb_build_object('en',btrim(p_name),p_locale,btrim(p_name));
 select * into prior from public.item_types where tenant_id=p_tenant and slug=v_slug;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('slug',attribute_slug,'expected',expected,'sort',sort) order by sort,attribute_slug),'[]'::jsonb)
   into prior_attrs from public.item_type_attributes where tenant_id=p_tenant and type_slug=v_slug;
  if prior.created_by is distinct from uid or prior.labels is distinct from names or not prior.active
   or prior.suggested_category<>'' or prior_attrs is distinct from attrs then raise exception 'REQUEST_CONFLICT'; end if;
  return v_slug;
 end if;
 vocabulary:=public.attribute_vocabulary(p_tenant);
 if exists(select 1 from jsonb_array_elements(attrs) a where not exists(
  select 1 from jsonb_array_elements(vocabulary->'definitions') d where d->>'slug'=a->>'slug' and (d->>'active')::boolean
 )) then raise exception 'INVALID_INPUT'; end if;
 perform public.set_item_type(p_tenant,v_slug,jsonb_build_object('labels',names,'attributes',attrs));
 return v_slug;
end $$;
revoke all on function public.create_item_type(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.create_item_type(uuid,uuid,text,text,jsonb) to authenticated;
