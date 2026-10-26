-- Keep note writes in the same transaction as the corresponding registration.
create function public.save_reception_sources_noted(p_tenant uuid,p_request uuid,p_session uuid,p_expected integer,p_sources jsonb,p_note text,p_note_expected uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result:=public.save_reception_sources(p_tenant,p_request,p_session,p_expected,p_sources);
 perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_request::text||':internal-note'),'reception',p_session,p_note_expected,p_note);
 return result;
end $$;
create function public.register_purchase_noted(p_tenant uuid,p_id uuid,p_note text,p_price_ore bigint,p_evidence text,p_margin_eligible boolean,p_internal_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result:=public.register_purchase(p_tenant,p_id,p_note,p_price_ore,p_evidence,p_margin_eligible);
 perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_id::text||':internal-note'),'purchase',p_id,null,p_internal_note);
 return result;
end $$;
revoke all on function public.save_reception_sources_noted(uuid,uuid,uuid,integer,jsonb,text,uuid),public.register_purchase_noted(uuid,uuid,text,bigint,text,boolean,text) from public,anon;
grant execute on function public.save_reception_sources_noted(uuid,uuid,uuid,integer,jsonb,text,uuid),public.register_purchase_noted(uuid,uuid,text,bigint,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION public.attribute_vocabulary(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare defs jsonb; types jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.slug),'[]'::jsonb) into defs from (
  select distinct on (c.slug) c.slug, c.version, c.data_type, c.unit, c.choices, c.labels, c.help, c.active,
   (c.tenant_id is not null) as own
  from public.attribute_definitions c
  where c.tenant_id is null or c.tenant_id=p_tenant
  order by c.slug, (c.tenant_id is not null) desc, c.version desc
 ) d;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.slug),'[]'::jsonb) into types from (
  select distinct on (y.slug) y.slug, y.labels, y.suggested_category, y.suggested_category_id, y.active, y.inherit_attributes, (y.tenant_id is not null) as own,
   case when y.inherit_attributes then (select coalesce(jsonb_agg(jsonb_build_object('slug',a,'expected',false,'sort',n) order by n),'[]'::jsonb) from jsonb_array_elements_text(komisio_private.registration_settings(p_tenant)->'settings'->'attributes') with ordinality e(a,n)) else coalesce((select jsonb_agg(jsonb_build_object('slug',a.attribute_slug,'expected',a.expected,'sort',a.sort) order by a.sort, a.attribute_slug)
     from public.item_type_attributes a
     where a.type_slug=y.slug and a.tenant_id is not distinct from y.tenant_id),'[]'::jsonb) end as attributes
  from public.item_types y
  where y.tenant_id is null or y.tenant_id=p_tenant
  order by y.slug, (y.tenant_id is not null) desc
 ) t;
 return jsonb_build_object('definitions',defs,'types',types,'registration',komisio_private.registration_settings(p_tenant));
end $function$;
create or replace function public.create_inheriting_item_type(p_tenant uuid,p_id uuid,p_name text,p_locale text) returns text
language plpgsql security definer set search_path='' as $$
declare result text; prior public.item_types;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.item_types where tenant_id=p_tenant and slug='custom_'||replace(p_id::text,'-','');
 if found and not prior.inherit_attributes then raise exception 'REQUEST_CONFLICT'; end if;
 result:=public.create_item_type(p_tenant,p_id,p_name,p_locale,'[{"slug":"description","expected":false,"sort":0}]');
 update public.item_types set inherit_attributes=true where tenant_id=p_tenant and slug=result;
 return result;
end $$;
