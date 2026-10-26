-- Label attribute choices are store settings, independent of accepted terms and queued ZPL.
alter table public.label_formats
 add column attribute_order text[],
 add column attribute_revision integer not null default 0 check(attribute_revision>=0),
 add column attribute_request uuid,
 add constraint item_label_attribute_scope check(kind='item' or attribute_order is null);

create function public.item_label_fields(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('fields',attribute_order,'revision',attribute_revision) from public.label_formats where tenant_id=p_tenant and kind='item'),'{"fields":null,"revision":0}'::jsonb);
end $$;

create function public.set_item_label_fields(p_tenant uuid,p_id uuid,p_expected integer,p_fields text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.label_formats; defaults jsonb; vocabulary jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_expected is null or p_expected<0 or p_expected>=2147483647 then raise exception 'INVALID_INPUT'; end if;
 if p_fields is not null then
  if cardinality(p_fields)>4 or array_ndims(p_fields)>1 or array_position(p_fields,null) is not null
   or cardinality(p_fields)<>(select count(distinct x) from unnest(p_fields) x)
   or exists(select 1 from unnest(p_fields) x where x !~ '^[a-z][a-z0-9_]{0,39}$' or x in ('description','category')) then raise exception 'INVALID_INPUT'; end if;
 end if;
 select * into prior from public.label_formats where tenant_id=p_tenant and kind='item';
 if prior.attribute_request=p_id then
  if prior.attribute_order is distinct from p_fields or prior.attribute_revision<>p_expected+1 then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if coalesce(prior.attribute_revision,0)<>p_expected then raise exception 'LABEL_FIELDS_CHANGED'; end if;
 vocabulary:=public.attribute_vocabulary(p_tenant);
 if p_fields is not null and exists(select 1 from unnest(p_fields) x where not exists(select 1 from jsonb_array_elements(vocabulary->'definitions') d where d->>'slug'=x and (d->>'active')::boolean)) then raise exception 'INVALID_INPUT'; end if;
 defaults:=komisio_private.default_label_format('item');
 insert into public.label_formats(tenant_id,kind,width_mm,height_mm,updated_by,attribute_order,attribute_revision,attribute_request)
 values(p_tenant,'item',(defaults->>'widthMm')::numeric,(defaults->>'heightMm')::numeric,uid,p_fields,p_expected+1,p_id)
 on conflict(tenant_id,kind) do update set attribute_order=excluded.attribute_order,attribute_revision=excluded.attribute_revision,attribute_request=excluded.attribute_request,updated_by=uid,updated_at=now();
 perform komisio_private.record_access(p_tenant,'label_fields.set',p_id,jsonb_build_object('fields',p_fields,'revision',p_expected+1));
 return p_id;
end $$;
revoke all on function public.item_label_fields(uuid),public.set_item_label_fields(uuid,uuid,integer,text[]) from public,anon;
grant execute on function public.item_label_fields(uuid),public.set_item_label_fields(uuid,uuid,integer,text[]) to authenticated;

-- Descriptive label facts never change accepted terms or accounting evidence.
create or replace function public.item_label_facts(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare title jsonb; facts jsonb; attrs jsonb; profile jsonb; selected_fields text[];
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return null; end if;
 select attribute_order into selected_fields from public.label_formats where tenant_id=p_tenant and kind='item';
 title:=komisio_private.item_title(p_tenant,p_item);
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 select t into profile from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t
 where t->>'slug'=komisio_private.item_classification(p_tenant,p_item)->>'itemType';
 select coalesce(jsonb_agg(entry order by ordering,slug),'[]') into attrs from (
  select a->>'slug' slug,
   case when selected_fields is null then coalesce((select (q->>'sort')::int from jsonb_array_elements(profile->'attributes') q where q->>'slug'=a->>'slug'),2147483647) else array_position(selected_fields,a->>'slug') end ordering,
   jsonb_build_object('slug',a->>'slug','value',a->>'value','labels',coalesce(d.labels,'{}'),
    'dataType',coalesce(d.data_type,'text'),'unit',coalesce(d.unit,''),'choices',coalesce(d.choices,'[]')) entry
  from jsonb_array_elements(komisio_private.item_attributes(p_tenant,p_item)) a
  left join lateral (
   select x.labels,x.data_type,x.unit,x.choices from public.attribute_definitions x
   where x.slug=a->>'slug' and x.version=(a->>'definitionVersion')::int and (x.tenant_id=p_tenant or x.tenant_id is null)
   order by (x.tenant_id is not null) desc limit 1
  ) d on true
  where (selected_fields is null or a->>'slug'=any(selected_fields)) and a->>'slug' not in ('description','category') and nullif(trim(a->>'value'),'') is not null
  order by ordering,slug limit 4
 ) selected;
 return jsonb_build_object('id',p_item,'reference','I-'||upper(left(p_item::text,8)),
  'title',title->>'title','priceOre',facts->>'currentPriceOre','currency',komisio_private.store_currency(p_tenant),'attributes',attrs);
end $$;


-- Copy the existing bounded/authorized selection without changing its identity or callers.
do $$ declare definition text;
begin
 definition:=pg_get_functiondef('public.item_label_sheet_facts(uuid,uuid,uuid[])'::regprocedure);
 if position('FUNCTION public.item_label_sheet_facts(' in definition)=0 then raise exception 'UNEXPECTED_LABEL_SHEET_DEFINITION'; end if;
 execute replace(definition,'FUNCTION public.item_label_sheet_facts(','FUNCTION komisio_private.label_sheet_before_seller(');
end $$;
revoke all on function komisio_private.label_sheet_before_seller(uuid,uuid,uuid[]) from public,anon,authenticated;
create or replace function public.item_label_sheet_facts(p_tenant uuid,p_bag uuid default null,p_items uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; seller uuid; seller_name text;
begin
 result:=komisio_private.label_sheet_before_seller(p_tenant,p_bag,p_items);
 select (array_agg(i.seller_id))[1] into seller
 from jsonb_array_elements(result->'items') x join public.items i on i.tenant_id=p_tenant and i.id=(x->>'id')::uuid
 having count(*)>0 and count(distinct i.seller_id)=1 and count(*)=count(i.seller_id);
 if seller is not null then select name into seller_name from public.sellers where tenant_id=p_tenant and id=seller and privacy_closed_at is null; end if;
 return result||jsonb_build_object('sellerName',seller_name);
end $$;
notify pgrst,'reload schema';
