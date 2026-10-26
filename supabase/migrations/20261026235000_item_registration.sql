-- Registration preferences are independent of commercial terms and label layout.
create table public.item_registration_settings (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0), previous_id uuid,
 settings jsonb not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(tenant_id,version)
);
alter table public.item_registration_settings enable row level security;
revoke all on public.item_registration_settings from anon,authenticated;
grant select on public.item_registration_settings to authenticated;
create policy registration_staff_read on public.item_registration_settings for select to authenticated
 using (public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));

create function komisio_private.registration_settings(p_tenant uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('id',id,'settings',settings) from public.item_registration_settings where tenant_id=p_tenant order by version desc limit 1),
 '{"id":null,"settings":{"descriptionRequired":false,"titleTemplate":"{type} {brand} {size}","attributes":["brand","size","color","condition","material"]}}'::jsonb);
$$;
create function public.registration_settings(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.registration_settings(p_tenant);
end $$;
create function public.publish_registration_settings(p_tenant uuid,p_id uuid,p_expected uuid,p_settings jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_registration_settings; cur public.item_registration_settings; token text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_settings is null or jsonb_typeof(p_settings)<>'object'
  or not(p_settings ?& array['descriptionRequired','titleTemplate','attributes'])
  or p_settings-array['descriptionRequired','titleTemplate','attributes']<>'{}'
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

-- Preserve explicitly configured store types. Shared starter profiles inherit.
alter table public.item_types add column inherit_attributes boolean not null default true;
update public.item_types set inherit_attributes=false where tenant_id is not null;

create table public.item_internal_notes (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 subject_kind text not null check(subject_kind in ('item','reception','purchase')),
 subject_id uuid not null, previous_id uuid, version integer not null check(version>0),
 note text not null check(length(note)<=2000), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(tenant_id,subject_kind,subject_id,version)
);
alter table public.item_internal_notes enable row level security;
revoke all on public.item_internal_notes from anon,authenticated;
grant select on public.item_internal_notes to authenticated;
create policy internal_notes_staff_read on public.item_internal_notes for select to authenticated
 using (public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create function public.item_internal_note(p_tenant uuid,p_kind text,p_subject uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; item public.items;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('item','reception','purchase') or p_subject is null then raise exception 'INVALID_INPUT'; end if;
 select jsonb_build_object('id',id,'note',note) into result from public.item_internal_notes
 where tenant_id=p_tenant and subject_kind=p_kind and subject_id=p_subject order by version desc limit 1;
 if result is not null then return result; end if;
 if p_kind='item' then
  select * into item from public.items where tenant_id=p_tenant and id=p_subject;
  if item.origin_kind in ('purchase','reception_review') then
   select jsonb_build_object('id',null,'note',note) into result from public.item_internal_notes
    where tenant_id=p_tenant and subject_kind=case item.origin_kind when 'purchase' then 'purchase' else 'reception' end
     and subject_id=item.origin_id order by version desc limit 1;
  end if;
 end if;
 return coalesce(result,'{"id":null,"note":""}'::jsonb);
end $$;
create function public.save_item_internal_note(p_tenant uuid,p_id uuid,p_kind text,p_subject uuid,p_expected uuid,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_internal_notes; cur public.item_internal_notes;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_subject is null or p_kind is null or p_kind not in ('item','reception','purchase') or p_note is null or length(p_note)>2000 then raise exception 'INVALID_INPUT'; end if;
 if (p_kind='item' and not exists(select 1 from public.items where tenant_id=p_tenant and id=p_subject))
  or (p_kind='reception' and not exists(select 1 from public.reception_sessions where tenant_id=p_tenant and id=p_subject))
  or (p_kind='purchase' and not exists(select 1 from public.purchase_receipts where tenant_id=p_tenant and id=p_subject)) then raise exception 'ITEM_NOT_FOUND'; end if;
 select * into prior from public.item_internal_notes where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.subject_kind is distinct from p_kind or prior.subject_id is distinct from p_subject
   or prior.previous_id is distinct from p_expected or prior.note is distinct from trim(p_note) or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into cur from public.item_internal_notes where tenant_id=p_tenant and subject_kind=p_kind and subject_id=p_subject order by version desc limit 1;
 if cur.id is distinct from p_expected then raise exception 'NOTE_CHANGED'; end if;
 insert into public.item_internal_notes(id,tenant_id,subject_kind,subject_id,previous_id,version,note,created_by)
 values(p_id,p_tenant,p_kind,p_subject,p_expected,coalesce(cur.version,0)+1,trim(p_note),uid);
 return p_id;
end $$;

create function komisio_private.registration_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_REGISTRATION_RECORD'; end $$;
create trigger immutable_registration_settings before update or delete on public.item_registration_settings for each row execute function komisio_private.registration_immutable();
create trigger immutable_internal_note before update or delete on public.item_internal_notes for each row execute function komisio_private.registration_immutable();

create function public.quick_receive_noted(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_item_type text,p_group uuid,p_category uuid,p_bag uuid,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.quick_receive_categorized(p_tenant,p_request,p_session,p_seller,p_expected,p_facts,p_price_ore,p_bag,p_item_type,p_group,p_category);
 perform public.save_item_internal_note(p_tenant,komisio_private.derived_uuid(p_request::text||':internal-note'),'item',(result->>'itemId')::uuid,null,p_note);
 return result;
end $$;

revoke all on function public.registration_settings(uuid),public.publish_registration_settings(uuid,uuid,uuid,jsonb),public.item_internal_note(uuid,text,uuid),public.save_item_internal_note(uuid,uuid,text,uuid,uuid,text),public.quick_receive_noted(uuid,uuid,uuid,uuid,integer,jsonb,bigint,text,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.registration_settings(uuid),public.publish_registration_settings(uuid,uuid,uuid,jsonb),public.item_internal_note(uuid,text,uuid),public.save_item_internal_note(uuid,uuid,text,uuid,uuid,text),public.quick_receive_noted(uuid,uuid,uuid,uuid,integer,jsonb,bigint,text,uuid,uuid,uuid,text) to authenticated;
revoke all on function komisio_private.registration_settings(uuid),komisio_private.registration_immutable() from public,anon,authenticated;

-- Effective vocabulary and tenant-aware validation.
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
   case when y.inherit_attributes then (select jsonb_agg(jsonb_build_object('slug',a,'expected',false,'sort',n) order by n) from jsonb_array_elements_text(komisio_private.registration_settings(p_tenant)->'settings'->'attributes') with ordinality e(a,n)) else coalesce((select jsonb_agg(jsonb_build_object('slug',a.attribute_slug,'expected',a.expected,'sort',a.sort) order by a.sort, a.attribute_slug)
     from public.item_type_attributes a
     where a.type_slug=y.slug and a.tenant_id is not distinct from y.tenant_id),'[]'::jsonb) end as attributes
  from public.item_types y
  where y.tenant_id is null or y.tenant_id=p_tenant
  order by y.slug, (y.tenant_id is not null) desc
 ) t;
 return jsonb_build_object('definitions',defs,'types',types,'registration',komisio_private.registration_settings(p_tenant));
end $function$;
CREATE OR REPLACE FUNCTION public.set_item_type(p_tenant uuid, p_slug text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare category uuid; name text; result jsonb; payload jsonb:=p_payload; inherit boolean;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if payload ? 'inheritAttributes' and jsonb_typeof(payload->'inheritAttributes')<>'boolean' then raise exception 'INVALID_INPUT'; end if;
 inherit:=coalesce((payload->>'inheritAttributes')::boolean,false);
 payload:=payload-'inheritAttributes';
 if payload ? 'suggestedCategoryId' then
  begin category:=(payload->>'suggestedCategoryId')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  if category is not null then
   select c.name into name from komisio_private.current_item_categories c where c.tenant_id=p_tenant and c.id=category and c.active;
   -- An unchanged archived default may survive an unrelated type edit.
   if not found then
    select c.name into name from komisio_private.current_item_categories c join public.item_types t on t.tenant_id=c.tenant_id and t.suggested_category_id=c.id
     where c.tenant_id=p_tenant and c.id=category and t.slug=p_slug;
    if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;
   end if;
  end if;
  payload:=(payload-'suggestedCategoryId')||jsonb_build_object('suggestedCategory',coalesce(name,''));
 else
  select m.category_id into category from komisio_private.category_match(p_tenant,payload->>'suggestedCategory') m;
 end if;
 result:=komisio_private.set_item_type_before_category_id(p_tenant,p_slug,payload);
 update public.item_types set suggested_category_id=category,inherit_attributes=inherit where tenant_id=p_tenant and slug=p_slug;
 return result;
end $function$;
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
  where t->>'slug'<>p_slug and lower(trim(l.value))=lower(trim(n.value))) then raise exception 'ITEM_TYPE_NAME_EXISTS'; end if;
 perform public.set_item_type(p_tenant,p_slug,p_payload);
 return (select t from jsonb_array_elements(public.attribute_vocabulary(p_tenant)->'types') t where t->>'slug'=p_slug);
end $function$;
create function public.create_inheriting_item_type(p_tenant uuid,p_id uuid,p_name text,p_locale text) returns text
language plpgsql security definer set search_path='' as $$
declare result text; prior public.item_types;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 result:=public.create_item_type(p_tenant,p_id,p_name,p_locale,'[{"slug":"description","expected":false,"sort":0}]');
 update public.item_types set inherit_attributes=true where tenant_id=p_tenant and slug=result;
 return result;
end $$;
revoke all on function public.create_inheriting_item_type(uuid,uuid,text,text) from public,anon;
grant execute on function public.create_inheriting_item_type(uuid,uuid,text,text) to authenticated;
CREATE OR REPLACE FUNCTION komisio_private.valid_reception_review(value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare price jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 -- metadata is still tolerated on a row written before this migration; it is
 -- never required and never read.
 if not(value ?& array['attributes','price','questions']) or (value-array['attributes','price','questions','itemType','metadata'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 if value ? 'itemType' and (jsonb_typeof(value->'itemType')<>'string' or (value->>'itemType') !~ '^[a-z][a-z0-9_]{0,39}$') then return false; end if;
 if not komisio_private.valid_item_attributes(value->'attributes') then return false; end if;
 -- Publication is where evidence is required: every observation a seller is
 -- asked to approve cites the photo or the note it came from.
 if exists(select 1 from jsonb_array_elements(value->'attributes') a where not komisio_private.valid_reception_refs(a->'sourceIds')) then return false; end if;
 price:=value->'price';
 if jsonb_typeof(price)<>'object' then return false; end if;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR','USD') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $function$;
CREATE OR REPLACE FUNCTION public.quick_receive(p_tenant uuid, p_request uuid, p_session uuid, p_seller uuid, p_expected integer, p_facts jsonb, p_price_ore bigint, p_item_type text DEFAULT NULL::text)
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
 if p_item_type is not null and not exists(select 1 from public.item_types t where t.slug=p_item_type and (t.tenant_id is null or t.tenant_id=p_tenant)) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
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
CREATE OR REPLACE FUNCTION public.publish_reception_review(p_tenant uuid, p_request uuid, p_session uuid, p_source_revision integer, p_previous uuid, p_agreement uuid, p_suggestions jsonb, p_expires timestamp with time zone)
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
  where t.slug=sug->>'itemType' and (t.tenant_id is null or t.tenant_id=p_tenant)) then raise exception 'ITEM_TYPE_UNDEFINED'; end if;
 for ref in select * from jsonb_array_elements_text(sug->'price'->'sourceIds') loop
  if not exists(select 1 from jsonb_array_elements(src.sources) source where source->>'id'=ref and source->>'kind'='price-evidence') then raise exception 'RECEPTION_PRICE_EVIDENCE_REQUIRED'; end if;
 end loop;
 insert into public.reception_reviews(id,tenant_id,session_id,version,source_revision,previous_review_id,agreement_id,seller_email,suggestions,expires_at,created_by)
 values(p_request,p_tenant,p_session,coalesce(latest.version,0)+1,p_source_revision,p_previous,p_agreement,address,sug,p_expires,uid);
 perform komisio_private.record_access(p_tenant,'reception.review_published',p_session,jsonb_build_object('review_id',p_request,'version',coalesce(latest.version,0)+1));
 return p_request;
end $function$;
CREATE OR REPLACE FUNCTION public.complete_submission_reception(p_tenant uuid, p_submission uuid, p_description text, p_price text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid; proposal public.seller_submissions; sources jsonb:='[]'; path text; photo uuid; target text; amount numeric;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select session_id into sid from public.submission_receptions where tenant_id=p_tenant and submission_id=p_submission;
 if not found then raise exception 'RECEPTION_NOT_FOUND'; end if;
 -- Another worker or a lost response may already have initialized this draft.
 -- Never overwrite subsequent staff work or repeat physical acceptance.
 if exists(select 1 from public.reception_source_revisions where tenant_id=p_tenant and session_id=sid) then return sid; end if;
 select * into proposal from public.seller_submissions where tenant_id=p_tenant and id=p_submission;
 if p_description is null or length(trim(p_description)) not between 0 and 1000 or p_price is null or p_price !~ '^(0|[1-9][0-9]{0,6})\.[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
 if (komisio_private.registration_settings(p_tenant)->'settings'->>'descriptionRequired')::boolean and trim(p_description)='' then raise exception 'DESCRIPTION_REQUIRED'; end if;
 amount:=p_price::numeric;
 if amount<=0 then raise exception 'INVALID_INPUT'; end if;
 if proposal.price_currency is not null and proposal.price_currency is distinct from komisio_private.store_currency(p_tenant) then raise exception 'CURRENCY_MISMATCH'; end if;
 for path in select jsonb_array_elements_text(proposal.photos) loop
  photo:=split_part(split_part(path,'/',3),'.',1)::uuid;
  target:=p_tenant::text||'/'||sid::text||'/'||photo::text||'.jpg';
  if not exists(select 1 from storage.objects where bucket_id='reception-photos' and name=target)
   or not exists(select 1 from storage.objects where bucket_id='seller-reception-photos' and name=target) then raise exception 'PHOTO_NOT_FOUND'; end if;
  sources:=sources||jsonb_build_array(jsonb_build_object('id',photo,'kind','photo','reference',target,'observation',''));
 end loop;
 if trim(p_description)<>'' then sources:=sources||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind','observation','reference','komisio:manual-description:v1','observation',trim(p_description))); end if;
 sources:=sources||jsonb_build_array(
  jsonb_build_object('id',gen_random_uuid(),'kind','price-evidence','reference','komisio:manual-appraisal:v1','observation',jsonb_build_object('amount',amount::numeric(12,2)::text,'reference','Submission '||p_submission::text,'rationale','Staff confirmed the proposed reception price')::text));
 perform public.save_reception_sources(p_tenant,gen_random_uuid(),sid,0,sources);
 return sid;
end $function$;
CREATE OR REPLACE FUNCTION public.register_purchase(p_tenant uuid, p_id uuid, p_note text, p_price_ore bigint, p_evidence text, p_margin_eligible boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=komisio_private.require_identity(); previous public.purchase_receipts; n text:=trim(coalesce(p_note,'')); e text:=trim(coalesce(p_evidence,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_price_ore is null or p_price_ore<0 or p_price_ore>99999999999 or length(n)>500
  or length(e) not between 1 and 500 or p_margin_eligible is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.purchase_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid or previous.supplier_note is distinct from n
   or previous.purchase_price_ore is distinct from p_price_ore or previous.evidence_reference is distinct from e
   or previous.margin_eligible is distinct from p_margin_eligible then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if (komisio_private.registration_settings(p_tenant)->'settings'->>'descriptionRequired')::boolean and n='' then raise exception 'DESCRIPTION_REQUIRED'; end if;
 insert into public.purchase_receipts(id,tenant_id,supplier_note,purchase_price_ore,currency,evidence_reference,margin_eligible,created_by)
 values(p_id,p_tenant,n,p_price_ore,komisio_private.store_currency(p_tenant),e,p_margin_eligible,uid);
 perform komisio_private.record_access(p_tenant,'purchase.registered',p_id,jsonb_build_object('price_ore',p_price_ore,'margin_eligible',p_margin_eligible));
 return p_id;
end $function$;
create or replace function komisio_private.item_title(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare attrs jsonb; title text; template text; token text; val text; kind text; lang text; def public.attribute_definitions;
begin
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then return jsonb_build_object('title',null,'category',null,'condition',null); end if;
 attrs:=komisio_private.item_attributes(p_tenant,p_item);
 select nullif(trim(a->>'value'),'') into title from jsonb_array_elements(attrs) a where a->>'slug'='description' limit 1;
 if title is null then
  template:=komisio_private.registration_settings(p_tenant)->'settings'->>'titleTemplate';
  lang:=coalesce(public.current_store_policy(p_tenant)->'policy'->>'itemLanguage','sv');
  kind:=komisio_private.item_classification(p_tenant,p_item)->>'itemType';
  foreach token in array array['type','brand','size','color','condition','material'] loop
   val:=null;
   if token='type' then
    select coalesce(labels->>lang,labels->>'en',slug) into val from public.item_types where slug=kind and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc limit 1;
   else
    select a->>'value' into val from jsonb_array_elements(attrs) a where a->>'slug'=token limit 1;
    select * into def from public.attribute_definitions where slug=token and (tenant_id=p_tenant or tenant_id is null) order by (tenant_id is not null) desc,version desc limit 1;
    if def.data_type='choice' then
     val:=coalesce((select coalesce(c->'labels'->>lang,c->'labels'->>'en',val) from jsonb_array_elements(def.choices) c where c->>'id'=val limit 1),val);
    end if;
   end if;
   template:=replace(template,'{'||token||'}',coalesce(val,''));
  end loop;
  title:=coalesce(nullif(trim(regexp_replace(template,'[[:space:]]+',' ','g')),''),'I-'||upper(left(p_item::text,8)));
 end if;
 return jsonb_build_object('title',title,'category',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='category' limit 1),'condition',(select nullif(trim(a->>'value'),'') from jsonb_array_elements(attrs) a where a->>'slug'='condition' limit 1));
end $$;
