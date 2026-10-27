-- #680: item types resolve only inside their store. Attribute definitions stay shared.
begin;
-- Serialize with store creation and engine writers before changing resolution.
lock table public.tenants in share row exclusive mode;
do $$ begin perform 1 from public.tenants order by id for update; end $$;
lock table public.item_types, public.item_type_attributes in access exclusive mode;

create or replace function komisio_private.catalogue_usage_before_category_defaults(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare names text[]:='{}'; profiles bigint:=0; items bigint:=0; history bigint:=0; receptions bigint:=0;
 proposals bigint:=0; settings bigint:=0; refs jsonb; target record; n bigint;
begin
 if p_kind='category' then
  select array_agg(distinct lower(trim(v))) into names from (
   select c.name,c.labels from public.item_categories c where c.tenant_id=p_tenant and c.id::text=p_key
   union all select c.name,c.labels from public.item_category_versions c where c.tenant_id=p_tenant and c.category_id::text=p_key
  ) c cross join lateral (select c.name v union select value from jsonb_each_text(c.labels)) l;
  select count(*) into profiles from public.item_types t where tenant_id=p_tenant and lower(trim(suggested_category))=any(names);
 elsif p_kind='attribute' then
  select count(*) into profiles from public.item_type_attributes a where tenant_id=p_tenant and attribute_slug=p_key;
 end if;
 -- All stages, all corrections and classification versions, including superseded ones.
 select count(*) into items from public.items i where i.tenant_id=p_tenant and (
  komisio_private.catalogue_json_reference(komisio_private.item_attributes(p_tenant,i.id),p_kind,p_key,names)
  or exists(select 1 from public.item_attribute_corrections a where a.tenant_id=p_tenant and a.item_id=i.id
    and ((p_kind='attribute' and a.slug=p_key) or (p_kind='category' and a.slug='category' and lower(trim(a.value))=any(names))))
  or exists(select 1 from public.item_classification_versions c where c.tenant_id=p_tenant and c.item_id=i.id
    and ((p_kind='type' and c.item_type=p_key) or (p_kind='group' and c.group_id::text=p_key)))
  or exists(select 1 from public.reception_reviews r where r.tenant_id=p_tenant and r.session_id=i.origin_id
    and komisio_private.catalogue_json_reference(r.suggestions,p_kind,p_key,names)));
 select count(*) into history from public.item_classification_batches where tenant_id=p_tenant
  and ((p_kind='type' and item_type=p_key) or (p_kind='group' and group_id::text=p_key));
 select count(*) into receptions from public.reception_reviews where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(suggestions,p_kind,p_key,names);
 select receptions+count(*) into receptions from public.reception_source_revisions where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(sources,p_kind,p_key,names);
 select count(*) into proposals from public.pending_operations where tenant_id=p_tenant
  and komisio_private.catalogue_json_reference(payload,p_kind,p_key,names);
 -- Purchases can carry a type before or after commercial acceptance.
 if p_kind='type' then
  select items+count(*) into items from public.purchase_receipts where tenant_id=p_tenant and item_type=p_key;
 end if;
 -- Configurations are extensible JSON. Inspect structured references in store
 -- settings as well as ordinary item relations; never inspect free-text notes.
 for target in
  select c.table_name,c.column_name from information_schema.columns c
  where c.table_schema='public' and c.data_type='jsonb'
   and (p_kind='type' or c.column_name in ('policy','settings','config','configuration','mapping','mappings','vat_map',
    'snapshot','context','output','assistance_output','payload','previous_payload','answers','terms'))
   and c.table_name<>'pending_operations'
   and exists(select 1 from information_schema.columns t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.column_name='tenant_id')
 loop
  execute format('select count(*) from public.%I where tenant_id=$1 and komisio_private.catalogue_json_reference(%I,$2,$3,$4)',target.table_name,target.column_name)
   into n using p_tenant,p_kind,p_key,names;
  settings:=settings+n;
 end loop;
 if p_kind='category' then
  select history+count(*) into history from public.item_category_links where tenant_id=p_tenant and category_id::text=p_key;
 end if;
 refs:=jsonb_build_object('items',items,'profiles',profiles,'history',history,'receptions',receptions,'proposals',proposals,'settings',settings);
 return (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(refs) e(k,v) where v<>'0'::jsonb);
end $$;

-- References are tenant + slug, never platform row IDs. Inserting an own row
-- rebinds every existing reference without rewriting immutable evidence.
create or replace function komisio_private.copy_used_shared_item_types()
 returns table(store_number integer,copied_types integer)
language plpgsql security definer set search_path='' as $$
declare store record; shared public.item_types; copied uuid;
begin
 store_number:=0;
 for store in select id from public.tenants order by id for update loop
  store_number:=store_number+1; copied_types:=0;
  for shared in select * from public.item_types where tenant_id is null order by slug loop
   if exists(select 1 from public.item_types where tenant_id=store.id and slug=shared.slug) then continue; end if;
   if komisio_private.catalogue_usage(store.id,'type',shared.slug)='{}'::jsonb
    and not exists(select 1 from public.item_type_attributes where tenant_id=store.id and type_slug=shared.slug) then continue; end if;
   insert into public.item_types(tenant_id,slug,labels,suggested_category,active,inherit_attributes)
    values(store.id,shared.slug,shared.labels,shared.suggested_category,shared.active,shared.inherit_attributes)
    on conflict (tenant_id,slug) do nothing returning id into copied;
   if copied is not null then
    insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
     select store.id,type_slug,attribute_slug,expected,sort from public.item_type_attributes
     where tenant_id is null and type_slug=shared.slug
     on conflict (tenant_id,type_slug,attribute_slug) do nothing;
    copied_types:=copied_types+1;
   end if;
  end loop;
  return next;
 end loop;
end $$;
revoke all on function komisio_private.copy_used_shared_item_types() from public,anon,authenticated;

-- Names and identifiers never enter the migration report.
do $$ declare report record; begin
 for report in select * from komisio_private.copy_used_shared_item_types() loop
  raise notice 'Item types: store %, copied %',report.store_number,report.copied_types;
 end loop;
end $$;

-- Remove only untouched, unused inactive shadows installed by the old seed.
-- The exclusive table lock covers this transaction and the trigger replacement;
-- all grants/RLS remain in force and no application delete can interleave.
create temporary table unused_item_type_shadows on commit drop as
 select t.id,t.tenant_id,t.slug from public.item_types t join public.item_types shared
  on shared.tenant_id is null and shared.slug=t.slug
 where t.tenant_id is not null and t.slug in ('lamp','sweater')
  and t.created_by is null and not t.active and t.inherit_attributes
  and t.labels=shared.labels and t.suggested_category=shared.suggested_category
  and t.suggested_category_id is null
  and not exists(select 1 from public.access_events e where e.tenant_id=t.tenant_id
   and e.action='item_type.set' and e.detail->>'slug'=t.slug)
  and (select coalesce(jsonb_agg(jsonb_build_array(attribute_slug,expected,sort) order by attribute_slug),'[]') from public.item_type_attributes where tenant_id=t.tenant_id and type_slug=t.slug)
   =(select coalesce(jsonb_agg(jsonb_build_array(attribute_slug,expected,sort) order by attribute_slug),'[]') from public.item_type_attributes where tenant_id is null and type_slug=t.slug)
  and komisio_private.catalogue_usage(t.tenant_id,'type',t.slug)='{}'::jsonb;
drop trigger catalogue_delete on public.item_types;
delete from public.item_type_attributes a using unused_item_type_shadows s where a.tenant_id=s.tenant_id and a.type_slug=s.slug;
delete from public.item_types t using unused_item_type_shadows s where t.id=s.id;
create trigger catalogue_delete before delete on public.item_types for each row execute function komisio_private.guard_catalogue_delete('type');
drop table unused_item_type_shadows;


create or replace function komisio_private.seed_store_vocabulary() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Keep shared core/base definitions and their translations. Shadow the old
 -- example-only fields without deleting platform definitions or observations.
 insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help,active)
 select distinct on (d.slug) new.id,d.slug,d.version,d.data_type,d.unit,d.choices,d.labels,d.help,false
 from public.attribute_definitions d
 where d.tenant_id is null and d.slug in ('fit','height_cm','socket','max_wattage','dimmable')
 order by d.slug,d.version desc;

 insert into public.item_types(tenant_id,slug,labels) values
 (new.id,'jacket','{"sv":"Jacka","en":"Jacket","no":"Jakke","dk":"Jakke","fi":"Takki","de":"Jacke","es":"Chaqueta","it":"Giacca"}'),
 (new.id,'trousers','{"sv":"Byxor","en":"Trousers","no":"Bukser","dk":"Bukser","fi":"Housut","de":"Hose","es":"Pantalones","it":"Pantaloni"}');
 insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
 select new.id,t.slug,a.slug,a.slug='description',a.sort
 from (values ('jacket'),('trousers')) t(slug)
 cross join (values ('category',0),('description',1),('size',2),('color',3),('brand',4),('material',5),('condition',6)) a(slug,sort);
 return new;
end $$;

-- Tighten direct reads as well as the security-definer vocabulary entry point.
drop policy if exists read_types on public.item_types;
create policy read_types on public.item_types for select to authenticated
 using (public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
drop policy if exists read_profiles on public.item_type_attributes;
create policy read_profiles on public.item_type_attributes for select to authenticated
 using (public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));

create or replace function public.attribute_vocabulary(p_tenant uuid)
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
  where y.tenant_id=p_tenant
  order by y.slug, (y.tenant_id is not null) desc
 ) t;
 return jsonb_build_object('definitions',defs,'types',types,'registration',komisio_private.registration_settings(p_tenant));
end $function$;

-- Preserve existing authorization, replay handling and validation order.
create or replace function public.quick_receive(p_tenant uuid, p_request uuid, p_session uuid, p_seller uuid, p_expected integer, p_facts jsonb, p_price_ore bigint, p_item_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; attrs jsonb:='[]'::jsonb; k text; v text; ver integer; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_seller is null or p_expected is null or p_expected<0 or p_expected>=2147483646
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999 or p_facts is null or jsonb_typeof(p_facts)<>'object' then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 if coalesce(pol->>'intakeProfile','quick')='full' and not exists(select 1 from public.reception_sessions where tenant_id=p_tenant and id=p_session and bag_id is not null) then raise exception 'INTAKE_PROFILE_FULL'; end if;
 select * into sess from public.reception_sessions where tenant_id=p_tenant and id=p_session;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 if sess.seller_id<>p_seller then raise exception 'RECEPTION_SESSION_SELLER'; end if;
 select * into existing from public.items where tenant_id=p_tenant and origin_kind='reception_review' and origin_id=p_session;
 if found then
  -- The same garment again (a retried request): the item already exists.
  select id into garment_id from public.garment_receipts where tenant_id=p_tenant and session_id=p_session;
  return jsonb_build_object('itemId',existing.id,'reference','I-'||upper(left(existing.id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',existing.origin_revision);
 end if;
 select * into src from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if coalesce(src.revision,0)<>p_expected then raise exception 'RECEPTION_CHANGED'; end if;
 -- Any attribute the store can see, not a fixed list of seven: that is what
 -- lets a lamp record its socket. The definition must exist, which is what
 -- keeps the vocabulary from growing by typing.
 for k in select * from jsonb_object_keys(p_facts) loop
  if jsonb_typeof(p_facts->k)<>'string' or k !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from public.attribute_definitions d where d.slug=k and (d.tenant_id is null or d.tenant_id=p_tenant)) then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
 end loop;
 if p_item_type is not null and not exists(select 1 from public.item_types t where t.slug=p_item_type and t.tenant_id=p_tenant) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 price_source:=komisio_private.derived_uuid(p_request::text||':price');
 sources:=coalesce(src.sources,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',price_source::text,'kind','price-evidence','reference','Staff','observation','Quick reception: price set by staff'));
 perform public.save_reception_sources(p_tenant,komisio_private.derived_uuid(p_request::text||':sources'),p_session,p_expected,sources);
 select value->>'id' into photo_source from jsonb_array_elements(sources) value where value->>'kind'='photo' limit 1;
 for k in select * from jsonb_object_keys(p_facts) loop
  v:=trim(p_facts->>k);
  if v='' then continue; end if;
  if length(v)>1000 then raise exception 'INVALID_INPUT'; end if;
  -- The newest version the store sees: an observation binds to the meaning
  -- that was current when it was made.
  select max(d.version) into ver from public.attribute_definitions d
   where d.slug=k and (d.tenant_id is null or d.tenant_id=p_tenant)
     and (d.tenant_id is not null or not exists(select 1 from public.attribute_definitions o where o.slug=k and o.tenant_id=p_tenant));
  attrs:=attrs||jsonb_build_array(jsonb_build_object('slug',k,'definitionVersion',ver,'value',v,
   'sourceIds',jsonb_build_array(coalesce(photo_source,price_source::text)),'certainty','observed'));
 end loop;
 -- metadata stays empty; publish_reception_review derives it from the list so
 -- the two can never be written out of step.
 suggestions:=jsonb_build_object('attributes',attrs,
  'price',jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'amount',to_char(p_price_ore/100.0,'FM999999990.00'),'rationale','Set by staff at quick reception','sourceIds',jsonb_build_array(price_source::text)),
  'questions','[]'::jsonb)||(case when p_item_type is null then '{}'::jsonb else jsonb_build_object('itemType',p_item_type) end);
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select * into latest_review from public.reception_reviews where tenant_id=p_tenant and session_id=p_session order by version desc limit 1;
 review_id:=public.publish_reception_review(p_tenant,komisio_private.derived_uuid(p_request::text||':review'),p_session,p_expected+1,latest_review.id,agreement,suggestions,now()+interval '1 day');
 select version into review_version from public.reception_reviews where id=review_id;
 garment_id:=public.receive_garment(p_tenant,komisio_private.derived_uuid(p_request::text||':garment'),p_session,'');
 item_id:=public.accept_item(p_tenant,komisio_private.derived_uuid(p_request::text||':item'),'reception_review',p_session,review_version,p_price_ore);
 perform komisio_private.record_access(p_tenant,'item.quick_received',item_id,jsonb_build_object('session_id',p_session,'price_ore',p_price_ore,'photo',photo_source is not null));
 return jsonb_build_object('itemId',item_id,'reference','I-'||upper(left(item_id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',review_version);
end $function$;

create or replace function public.publish_reception_review(p_tenant uuid, p_request uuid, p_session uuid, p_source_revision integer, p_previous uuid, p_agreement uuid, p_suggestions jsonb, p_expires timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_reviews; latest public.reception_reviews;
 src public.reception_source_revisions; current_agreement uuid; address text; fact jsonb; ref text; sug jsonb; attr jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_source_revision is null or p_source_revision<1 or p_expires is null
  or not komisio_private.valid_reception_review(p_suggestions) then raise exception 'INVALID_INPUT'; end if;
 -- Nothing to normalise: the list is the only shape.
 sug:=p_suggestions;
 select * into prior from public.reception_reviews where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.created_by is distinct from uid
   or prior.source_revision is distinct from p_source_revision or prior.previous_review_id is distinct from p_previous
   or prior.agreement_id is distinct from p_agreement or prior.suggestions is distinct from sug or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if (komisio_private.registration_settings(p_tenant)->'settings'->>'descriptionRequired')::boolean
  and not exists(select 1 from jsonb_array_elements(sug->'attributes') a where a->>'slug'='description' and length(trim(a->>'value'))>0) then raise exception 'DESCRIPTION_REQUIRED'; end if;
 if sug->'price'->>'currency'<>komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 select s.email into address from public.reception_sessions r join public.sellers s on s.id=r.seller_id and s.tenant_id=r.tenant_id where r.id=p_session and r.tenant_id=p_tenant;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 select * into src from public.reception_source_revisions where session_id=p_session order by revision desc limit 1;
 if not found or src.revision<>p_source_revision then raise exception 'RECEPTION_CHANGED'; end if;
 select * into latest from public.reception_reviews where session_id=p_session order by version desc limit 1;
 if latest.id is distinct from p_previous then raise exception 'RECEPTION_REVIEW_CHANGED'; end if;
 if coalesce(latest.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 select id into current_agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_agreement is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_agreement is null and ((public.current_store_policy(p_tenant)->'policy'->'agreementRequiredFor') ? 'review_publication') then raise exception 'AGREEMENT_REQUIRED'; end if;
 if not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'RECEPTION_REVIEW_EXPIRED'; end if;
 for attr in select * from jsonb_array_elements(sug->'attributes') loop
  for ref in select * from jsonb_array_elements_text(attr->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref) then raise exception 'RECEPTION_UNKNOWN_SOURCE'; end if;
  end loop;
  -- A published review holds only attributes bound to a definition the store
  -- can see. An assistant's proposal for something undefined stays a proposal
  -- until a person binds it.
  if not exists(select 1 from public.attribute_definitions d
   where d.slug=attr->>'slug' and d.version=(attr->>'definitionVersion')::integer
    and (d.tenant_id is null or d.tenant_id=p_tenant)) then raise exception 'ATTRIBUTE_UNDEFINED' using detail=attr->>'slug'; end if;
 end loop;
 if sug ? 'itemType' and not exists(select 1 from public.item_types t
  where t.slug=sug->>'itemType' and t.tenant_id=p_tenant) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 for ref in select * from jsonb_array_elements_text(sug->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,sug,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $function$;

create or replace function public.register_purchase_described(p_tenant uuid, p_id uuid, p_note text, p_price_ore bigint, p_evidence text, p_margin_eligible boolean,p_facts jsonb,p_item_type text,p_internal_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); previous public.purchase_receipts; n text:=trim(coalesce(p_note,'')); e text:=trim(coalesce(p_evidence,'')); attrs jsonb:='[]'; fact record; def public.attribute_definitions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_price_ore is null or p_price_ore<0 or p_price_ore>99999999999 or length(n)>500
  or length(e) not between 1 and 500 or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 if p_facts is null or jsonb_typeof(p_facts)<>'object' or p_facts ?| array['description','category'] then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.purchase_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid or previous.supplier_note is distinct from n
   or previous.purchase_price_ore is distinct from p_price_ore or previous.evidence_reference is distinct from e
   or previous.margin_eligible is distinct from p_margin_eligible then raise exception 'REQUEST_CONFLICT'; end if;
  if previous.item_type is distinct from p_item_type or (select coalesce(jsonb_object_agg(a->>'slug',a->>'value'),'{}') from jsonb_array_elements(previous.registration_attributes) a) is distinct from p_facts then raise exception 'REQUEST_CONFLICT'; end if;
  perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_id::text||':internal-note'),'purchase',p_id,null,p_internal_note);
  return p_id;
 end if;
 if (komisio_private.registration_settings(p_tenant)->'settings'->>'descriptionRequired')::boolean and n='' then raise exception 'DESCRIPTION_REQUIRED'; end if;
 if p_item_type is not null and not exists(select 1 from public.item_types where slug=p_item_type and tenant_id=p_tenant and active) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 for fact in select * from jsonb_each(p_facts) loop
  if jsonb_typeof(fact.value)<>'string' or length(trim(fact.value#>>'{}')) not between 1 and 1000 then raise exception 'INVALID_INPUT'; end if;
  select * into def from public.attribute_definitions where slug=fact.key and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
  if not found or not def.active then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
  attrs:=attrs||jsonb_build_array(jsonb_build_object('slug',fact.key,'definitionVersion',def.version,'value',fact.value#>>'{}','sourceIds','[]'::jsonb,'certainty','observed'));
 end loop;
 insert into public.purchase_receipts(id,tenant_id,supplier_note,purchase_price_ore,currency,evidence_reference,margin_eligible,created_by,registration_attributes,item_type)
 values(p_id,p_tenant,n,p_price_ore,komisio_private.store_currency(p_tenant),e,p_margin_eligible,uid,attrs,p_item_type);
 perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_id::text||':internal-note'),'purchase',p_id,null,p_internal_note);
 perform komisio_private.record_access(p_tenant,'purchase.registered',p_id,jsonb_build_object('price_ore',p_price_ore,'margin_eligible',p_margin_eligible));
 return p_id;
end $function$
;

create or replace function komisio_private.item_title(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare title_values jsonb:='{}'; attrs jsonb; title text; template text; token text; val text; kind text; lang text; def public.attribute_definitions;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return jsonb_build_object('title',null,'category',null,'condition',null); end if;
 attrs:=komisio_private.item_attributes(p_tenant,p_item);
 select nullif(trim(a->>'value'),'') into title from jsonb_array_elements(attrs) a where a->>'slug'='description' limit 1;
 if title is null then
  template:=komisio_private.registration_settings(p_tenant)->'settings'->>'titleTemplate';
  lang:=coalesce(komisio_private.current_store_policy_core(p_tenant)->'policy'->>'itemLanguage','sv');
  kind:=komisio_private.item_classification(p_tenant,p_item)->>'itemType';
  foreach token in array array['type','brand','size','color','condition','material'] loop
   val:=null;
   if token='type' then
    select coalesce(labels->>lang,labels->>'en',slug) into val from public.item_types where slug=kind and tenant_id=p_tenant;
   else
    select a->>'value' into val from jsonb_array_elements(attrs) a where a->>'slug'=token limit 1;
    select * into def from public.attribute_definitions where slug=token and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
    if def.data_type='choice' then
     val:=coalesce((select coalesce(c->'labels'->>lang,c->'labels'->>'en',val) from jsonb_array_elements(def.choices) c where c->>'id'=val limit 1),val);
    end if;
   end if;
   title_values:=title_values||jsonb_build_object(token,coalesce(val,''));
  end loop;
  title:=coalesce(nullif(komisio_private.render_registration_title(template,title_values),''),'I-'||upper(left(p_item::text,8)));
 end if;
 return jsonb_build_object('title',title,'category',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='category' limit 1),'condition',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='condition' limit 1));
end $$;

create or replace function public.delete_catalogue_record(p_tenant uuid,p_kind text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); usage jsonb; existed boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('category','group','type','attribute') or p_key is null or length(p_key)>40 then raise exception 'INVALID_INPUT'; end if;
 if (p_kind in ('type','attribute') and p_key !~ '^[a-z][a-z0-9_]{0,39}$')
  or (p_kind in ('category','group') and p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'INVALID_INPUT'; end if;
 if p_kind='type' then
  select exists(select 1 from public.item_types where tenant_id=p_tenant and slug=p_key) into existed;
 elsif p_kind='attribute' then
  select exists(select 1 from public.attribute_definitions where tenant_id=p_tenant and slug=p_key) into existed;
  if not existed and exists(select 1 from public.attribute_definitions where tenant_id is null and slug=p_key) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 elsif p_kind='category' then
  select exists(select 1 from public.item_categories where tenant_id=p_tenant and id::text=p_key) into existed;
 else
  select exists(select 1 from public.assortment_groups where tenant_id=p_tenant and id::text=p_key) into existed;
 end if;
 if not existed then return jsonb_build_object('ok',true,'kind',p_kind,'key',p_key); end if;
 usage:=komisio_private.catalogue_usage(p_tenant,p_kind,p_key);
 if usage<>'{}'::jsonb then return jsonb_build_object('ok',false,'usage',usage); end if;
 if p_kind='category' then delete from public.item_categories where tenant_id=p_tenant and id::text=p_key;
 elsif p_kind='group' then delete from public.assortment_groups where tenant_id=p_tenant and id::text=p_key;
 elsif p_kind='attribute' then delete from public.attribute_definitions where tenant_id=p_tenant and slug=p_key;
 else
  delete from public.item_types where tenant_id=p_tenant and slug=p_key;
  delete from public.item_type_attributes where tenant_id=p_tenant and type_slug=p_key;
 end if;
 perform komisio_private.record_access(p_tenant,'catalogue.deleted',null,jsonb_build_object('kind',p_kind,'key',p_key));
 return jsonb_build_object('ok',true,'kind',p_kind,'key',p_key);
end $$;

commit;
