-- Add optional visibility preferences without rewriting historical settings or changing intake validation.
create or replace function public.publish_registration_settings(p_tenant uuid,p_id uuid,p_expected uuid,p_settings jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_registration_settings; cur public.item_registration_settings; token text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_settings is null or jsonb_typeof(p_settings)<>'object'
  or not(p_settings ?& array['descriptionRequired','titleTemplate','attributes'])
  or p_settings-array['descriptionRequired','titleTemplate','attributes','hiddenFields']<>'{}'
  or jsonb_typeof(p_settings->'descriptionRequired')<>'boolean'
  or jsonb_typeof(p_settings->'titleTemplate')<>'string'
  or length(trim(p_settings->>'titleTemplate')) not between 1 and 240
  or jsonb_typeof(p_settings->'attributes')<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_settings->'attributes')>100
  or exists(select 1 from jsonb_array_elements(p_settings->'attributes') a where jsonb_typeof(a)<>'string')
  or (select count(distinct a) from jsonb_array_elements_text(p_settings->'attributes') a)<>jsonb_array_length(p_settings->'attributes')
  or (p_settings->>'titleTemplate') ~ '[[:cntrl:]]' then raise exception 'INVALID_INPUT'; end if;
 -- Literal text is permitted; placeholders are deliberately bounded.
 if regexp_replace(p_settings->>'titleTemplate','\{(type|brand|size|color|condition|material)\}','','g') ~ '[{}]' then raise exception 'INVALID_INPUT'; end if;
 -- Old payloads stay valid and retain exact replay equality. Visibility is presentation only.
 if p_settings ? 'hiddenFields' then
  if jsonb_typeof(p_settings->'hiddenFields') <> 'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(p_settings->'hiddenFields') > 11
   or exists(select 1 from jsonb_array_elements(p_settings->'hiddenFields') f
    where jsonb_typeof(f) <> 'string' or (f #>> '{}') not in
     ('description','internalNote','photo','assortment','itemType','category','brand','size','color','condition','material'))
   or (select count(distinct f) from jsonb_array_elements(p_settings->'hiddenFields') f) <> jsonb_array_length(p_settings->'hiddenFields')
   or ((p_settings->>'descriptionRequired')::boolean and p_settings->'hiddenFields' ? 'description')
   then raise exception 'INVALID_INPUT'; end if;
 end if;
 select * into prior from public.item_registration_settings where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid or prior.previous_id is distinct from p_expected or prior.settings is distinct from p_settings then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into cur from public.item_registration_settings where tenant_id=p_tenant order by version desc limit 1;
 if cur.id is distinct from p_expected then raise exception 'REGISTRATION_CHANGED'; end if;
 for token in select jsonb_array_elements_text(p_settings->'attributes') loop
  if token in ('description','category') or not exists(select 1 from (
   select d.active from public.attribute_definitions d where d.slug=token and (d.tenant_id=p_tenant or d.tenant_id is null) order by (d.tenant_id is not null) desc,d.version desc limit 1
  ) d where d.active) then raise exception 'INVALID_INPUT'; end if;
 end loop;
 insert into public.item_registration_settings(id,tenant_id,version,previous_id,settings,created_by)
 values(p_id,p_tenant,coalesce(cur.version,0)+1,p_expected,p_settings,uid);
 return p_id;
end $$;
