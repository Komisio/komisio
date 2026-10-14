-- Create-only entry point for the settings form. Replays cannot overwrite later
-- changes made through the existing versioned vocabulary API.
create function public.create_store_attribute(p_tenant uuid,p_id uuid,p_payload jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); v_slug text; prior public.attribute_definitions;
 v_kind text; v_unit text; v_choices jsonb; v_labels jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or not(p_payload ?& array['dataType','labels']) or (p_payload-array['dataType','labels','unit','choices'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 v_kind:=p_payload->>'dataType'; v_unit:=coalesce(p_payload->>'unit','');
 v_choices:=coalesce(p_payload->'choices','[]'::jsonb); v_labels:=p_payload->'labels';
 if v_kind is null or v_kind not in ('text','number','choice','boolean')
  or length(v_unit)>16 or (v_unit<>'' and v_kind<>'number')
  or not komisio_private.valid_attribute_labels(v_labels) or v_labels='{}'::jsonb
  or not komisio_private.valid_attribute_choices(v_choices) then raise exception 'INVALID_INPUT'; end if;
 if (jsonb_array_length(v_choices)>0)<>(v_kind='choice') then raise exception 'INVALID_INPUT'; end if;
 v_slug:='custom_'||replace(p_id::text,'-','');
 select * into prior from public.attribute_definitions where tenant_id=p_tenant and slug=v_slug order by version desc limit 1;
 if found then
  if prior.created_by is distinct from uid or prior.version<>1 or not prior.active
   or prior.data_type is distinct from v_kind or prior.unit is distinct from v_unit
   or prior.choices is distinct from v_choices or prior.labels is distinct from v_labels or prior.help<>'{}'::jsonb then raise exception 'REQUEST_CONFLICT'; end if;
  return v_slug;
 end if;
 perform public.set_attribute_definition(p_tenant,v_slug,jsonb_build_object('dataType',v_kind,'unit',v_unit,'choices',v_choices,'labels',v_labels));
 return v_slug;
end $$;
revoke all on function public.create_store_attribute(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_store_attribute(uuid,uuid,jsonb) to authenticated;
