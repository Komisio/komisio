-- Attribute vocabulary and item types (2026-09-17, owner decision after the
-- review of private/design-item-attributes.md). First slice: the vocabulary
-- and the profiles that drive a form. No item stores an attribute yet; that is
-- the next slice.
--
-- Three concepts stay separate because they answer different questions. A
-- category is for navigation and reports, an item type decides which questions
-- to ask, and an attribute describes one object. A table lamp and a floor lamp
-- share a category and need different questions, which is why a type does not
-- replace a category. It only suggests one.
--
-- A definition with tenant_id null belongs to the platform and every store
-- sees it; a store adds its own and cannot touch the platform's. Slugs are
-- stable and never translated: the database stores `color`, the screen shows
-- "Färg" or "Farbe" from the labels object. Allowed values carry stable ids for
-- the same reason, or the spelling problem simply moves from the attribute
-- name to its value: marinblå, navy and mörkblå as three colours.
--
-- Versioning exists so that editing a setting today cannot change what an
-- observation meant last year. A change of meaning (data type, unit, allowed
-- values) inserts a new version and leaves the old one readable. A change of
-- presentation (a label, a help text, active) applies in place, because that is
-- what presentation means. A trigger enforces the line rather than trusting
-- the caller.

-- Labels are an object of locale to text, in the languages the product speaks.
-- A missing locale is not an error: the application falls back to English the
-- same way its dictionaries do.
create function komisio_private.valid_attribute_labels(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 for k, v in select * from jsonb_each(value) loop
  if k not in ('sv','en','no','dk','fi','de','es','it') then return false; end if;
  if jsonb_typeof(v)<>'string' or length(v->>0)=0 or length(v->>0)>120 then return false; end if;
 end loop;
 return true;
end $$;

-- Allowed values for a choice: each carries its own stable id, its labels and
-- its order. Ids are unique within the definition.
create function komisio_private.valid_attribute_choices(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; ids text[]:='{}';
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value)>200 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' then return false; end if;
  if not(item ?& array['id','labels']) or (item-array['id','labels','sort'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(item->'id')<>'string' or (item->>'id') !~ '^[a-z0-9][a-z0-9_]{0,39}$' then return false; end if;
  if not komisio_private.valid_attribute_labels(item->'labels') then return false; end if;
  if item ? 'sort' and (jsonb_typeof(item->'sort')<>'number' or (item->>'sort')::numeric<>trunc((item->>'sort')::numeric)) then return false; end if;
  if (item->>'id')=any(ids) then return false; end if;
  ids:=ids||(item->>'id');
 end loop;
 return true;
end $$;

create table public.attribute_definitions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid references public.tenants(id),
 slug text not null check(slug ~ '^[a-z][a-z0-9_]{0,39}$'),
 version integer not null check(version>0),
 data_type text not null check(data_type in ('text','number','choice','boolean')),
 unit text not null default '' check(length(unit)<=16),
 choices jsonb not null default '[]'::jsonb check(komisio_private.valid_attribute_choices(choices)),
 labels jsonb not null check(komisio_private.valid_attribute_labels(labels)),
 help jsonb not null default '{}'::jsonb check(komisio_private.valid_attribute_labels(help)),
 active boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique nulls not distinct (tenant_id,slug,version),
 -- A unit belongs to a number and choices belong to a choice. Anything else is
 -- a definition that means two things at once.
 check((unit<>'')<=(data_type='number')),
 check((jsonb_array_length(choices)>0)=(data_type='choice'))
);
create index attribute_definitions_current on public.attribute_definitions(tenant_id,slug,version desc);

create table public.item_types (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid references public.tenants(id),
 slug text not null check(slug ~ '^[a-z][a-z0-9_]{0,39}$'),
 labels jsonb not null check(komisio_private.valid_attribute_labels(labels)),
 suggested_category text not null default '' check(length(suggested_category)<=120),
 active boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique nulls not distinct (tenant_id,slug)
);

-- The profile: which attributes a type asks for, in which order, and which a
-- member of staff is expected to fill. Guidance, never a constraint.
create table public.item_type_attributes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid references public.tenants(id),
 type_slug text not null check(type_slug ~ '^[a-z][a-z0-9_]{0,39}$'),
 attribute_slug text not null check(attribute_slug ~ '^[a-z][a-z0-9_]{0,39}$'),
 expected boolean not null default false,
 sort integer not null default 0 check(sort between 0 and 999),
 unique nulls not distinct (tenant_id,type_slug,attribute_slug)
);
create index item_type_attributes_profile on public.item_type_attributes(tenant_id,type_slug,sort);

-- Presentation may be edited in place; meaning may not. A meaning change goes
-- through set_attribute_definition, which writes a new version.
create function komisio_private.preserve_definition_meaning() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_DEFINITION'; end if;
 if new.tenant_id is distinct from old.tenant_id or new.slug<>old.slug or new.version<>old.version
 or new.data_type<>old.data_type or new.unit<>old.unit or new.choices<>old.choices then
  raise exception 'IMMUTABLE_DEFINITION';
 end if;
 return new;
end $$;
create trigger definition_meaning before update or delete on public.attribute_definitions for each row execute function komisio_private.preserve_definition_meaning();

alter table public.attribute_definitions enable row level security;
alter table public.item_types enable row level security;
alter table public.item_type_attributes enable row level security;
revoke all on public.attribute_definitions,public.item_types,public.item_type_attributes from public,anon,authenticated;
grant select on public.attribute_definitions,public.item_types,public.item_type_attributes to authenticated;
-- The platform vocabulary is not store data and is readable by any signed-in
-- person; a store's own vocabulary is readable by its members.
create policy read_vocabulary on public.attribute_definitions for select to authenticated using(tenant_id is null or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy read_types on public.item_types for select to authenticated using(tenant_id is null or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy read_profiles on public.item_type_attributes for select to authenticated using(tenant_id is null or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy write_boundary on public.attribute_definitions as restrictive for all to authenticated using(true) with check(false);
create policy write_boundary on public.item_types as restrictive for all to authenticated using(true) with check(false);
create policy write_boundary on public.item_type_attributes as restrictive for all to authenticated using(true) with check(false);

-- Everything a store may ask about an item: the platform vocabulary, its own
-- on top, and the types with their profiles. A store definition shadows a
-- platform one of the same slug, so a store can retune an attribute without
-- inventing a second name for it.
create function public.attribute_vocabulary(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
  select distinct on (y.slug) y.slug, y.labels, y.suggested_category, y.active, (y.tenant_id is not null) as own,
   coalesce((select jsonb_agg(jsonb_build_object('slug',a.attribute_slug,'expected',a.expected,'sort',a.sort) order by a.sort, a.attribute_slug)
     from public.item_type_attributes a
     where a.type_slug=y.slug and a.tenant_id is not distinct from y.tenant_id),'[]'::jsonb) as attributes
  from public.item_types y
  where y.tenant_id is null or y.tenant_id=p_tenant
  order by y.slug, (y.tenant_id is not null) desc
 ) t;
 return jsonb_build_object('definitions',defs,'types',types);
end $$;
revoke all on function public.attribute_vocabulary(uuid) from public,anon;
grant execute on function public.attribute_vocabulary(uuid) to authenticated;

-- Create or change one of the store's own attribute definitions. A change of
-- meaning writes a new version; a change of presentation applies in place. The
-- platform vocabulary is not writable from here at all.
create function public.set_attribute_definition(p_tenant uuid,p_slug text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
-- The locals are prefixed because a bare `labels` in the update below is
-- ambiguous between this variable and the column, and Postgres refuses it.
declare uid uuid:=komisio_private.require_identity(); cur public.attribute_definitions;
 v_kind text; v_unit text; v_choices jsonb; v_labels jsonb; v_help jsonb; v_active boolean; changed boolean; next_version integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_slug is null or p_slug !~ '^[a-z][a-z0-9_]{0,39}$' or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if not(p_payload ?& array['dataType','labels']) or (p_payload-array['dataType','labels','unit','choices','help','active'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 v_kind:=p_payload->>'dataType';
 v_unit:=coalesce(p_payload->>'unit','');
 v_choices:=coalesce(p_payload->'choices','[]'::jsonb);
 v_labels:=p_payload->'labels';
 v_help:=coalesce(p_payload->'help','{}'::jsonb);
 v_active:=coalesce((p_payload->>'active')::boolean,true);
 if v_kind not in ('text','number','choice','boolean') then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.valid_attribute_labels(v_labels) or not komisio_private.valid_attribute_labels(v_help)
 or not komisio_private.valid_attribute_choices(v_choices) then raise exception 'INVALID_INPUT'; end if;
 -- The table refuses an incoherent definition too, but a caller deserves the
 -- same error code as every other bad input rather than a constraint name.
 if (v_unit<>'') and v_kind<>'number' then raise exception 'INVALID_INPUT'; end if;
 if (jsonb_array_length(v_choices)>0)<>(v_kind='choice') then raise exception 'INVALID_INPUT'; end if;
 select * into cur from public.attribute_definitions where tenant_id=p_tenant and slug=p_slug order by version desc limit 1;
 if not found then
  insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help,active,created_by)
  values(p_tenant,p_slug,1,v_kind,v_unit,v_choices,v_labels,v_help,v_active,uid);
  perform komisio_private.record_access(p_tenant,'attribute.defined',null,jsonb_build_object('slug',p_slug,'version',1));
  return jsonb_build_object('slug',p_slug,'version',1,'created',true);
 end if;
 changed:=(cur.data_type<>v_kind or cur.unit<>v_unit or cur.choices<>v_choices);
 if changed then
  next_version:=cur.version+1;
  insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help,active,created_by)
  values(p_tenant,p_slug,next_version,v_kind,v_unit,v_choices,v_labels,v_help,v_active,uid);
  perform komisio_private.record_access(p_tenant,'attribute.redefined',null,jsonb_build_object('slug',p_slug,'version',next_version,'from',cur.version));
  return jsonb_build_object('slug',p_slug,'version',next_version,'created',false);
 end if;
 update public.attribute_definitions set labels=v_labels, help=v_help, active=v_active where id=cur.id;
 return jsonb_build_object('slug',p_slug,'version',cur.version,'created',false);
end $$;
revoke all on function public.set_attribute_definition(uuid,text,jsonb) from public,anon;
grant execute on function public.set_attribute_definition(uuid,text,jsonb) to authenticated;

-- Create or change one of the store's own item types, profile included. The
-- profile is replaced wholesale, which is what an editor saves.
create function public.set_item_type(p_tenant uuid,p_slug text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); labels jsonb; cat text; act boolean; attrs jsonb; item jsonb; n integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_slug is null or p_slug !~ '^[a-z][a-z0-9_]{0,39}$' or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if not(p_payload ? 'labels') or (p_payload-array['labels','suggestedCategory','active','attributes'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 labels:=p_payload->'labels';
 cat:=left(coalesce(p_payload->>'suggestedCategory',''),120);
 act:=coalesce((p_payload->>'active')::boolean,true);
 attrs:=coalesce(p_payload->'attributes','[]'::jsonb);
 if not komisio_private.valid_attribute_labels(labels) or jsonb_typeof(attrs)<>'array' or jsonb_array_length(attrs)>100 then raise exception 'INVALID_INPUT'; end if;
 insert into public.item_types(tenant_id,slug,labels,suggested_category,active,created_by)
 values(p_tenant,p_slug,labels,cat,act,uid)
 on conflict (tenant_id,slug) do update set labels=excluded.labels,suggested_category=excluded.suggested_category,active=excluded.active;
 delete from public.item_type_attributes where tenant_id=p_tenant and type_slug=p_slug;
 for item in select * from jsonb_array_elements(attrs) loop
  if jsonb_typeof(item)<>'object' or not(item ? 'slug') or (item-array['slug','expected','sort'])<>'{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
  if (item->>'slug') !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'INVALID_INPUT'; end if;
  insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
  values(p_tenant,p_slug,item->>'slug',coalesce((item->>'expected')::boolean,false),coalesce((item->>'sort')::integer,n));
  n:=n+1;
 end loop;
 perform komisio_private.record_access(p_tenant,'item_type.set',null,jsonb_build_object('slug',p_slug,'attributes',n));
 return jsonb_build_object('slug',p_slug,'attributes',n);
end $$;
revoke all on function public.set_item_type(uuid,text,jsonb) from public,anon;
grant execute on function public.set_item_type(uuid,text,jsonb) to authenticated;

-- The platform seed. The seven attributes the reception assistant already
-- knows, plus enough for a lamp, so a member of staff who picks "Lamp" gets
-- the right questions without administering a vocabulary first. Labels are
-- Swedish and English; the application falls back to English for the other six
-- locales exactly as its dictionaries do, and a native pass can fill them in.
insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help) values
 (null,'description',1,'text','','[]'::jsonb,'{"sv":"Beskrivning","en":"Description"}'::jsonb,'{}'::jsonb),
 (null,'condition',1,'text','','[]'::jsonb,'{"sv":"Skick","en":"Condition"}'::jsonb,'{"sv":"Skador, slitage och annat en köpare bör veta.","en":"Damage, wear and anything a buyer should know."}'::jsonb),
 (null,'brand',1,'text','','[]'::jsonb,'{"sv":"Märke","en":"Brand"}'::jsonb,'{}'::jsonb),
 (null,'color',1,'text','','[]'::jsonb,'{"sv":"Färg","en":"Colour"}'::jsonb,'{}'::jsonb),
 (null,'material',1,'text','','[]'::jsonb,'{"sv":"Material","en":"Material"}'::jsonb,'{}'::jsonb),
 (null,'size',1,'text','','[]'::jsonb,'{"sv":"Storlek","en":"Size"}'::jsonb,'{}'::jsonb),
 (null,'fit',1,'choice','','[{"id":"womens","labels":{"sv":"Dam","en":"Women''s"},"sort":1},{"id":"mens","labels":{"sv":"Herr","en":"Men''s"},"sort":2},{"id":"unisex","labels":{"sv":"Unisex","en":"Unisex"},"sort":3},{"id":"childrens","labels":{"sv":"Barn","en":"Children''s"},"sort":4}]'::jsonb,'{"sv":"Passform","en":"Fit"}'::jsonb,'{}'::jsonb),
 (null,'height_cm',1,'number','cm','[]'::jsonb,'{"sv":"Höjd","en":"Height"}'::jsonb,'{}'::jsonb),
 (null,'socket',1,'choice','','[{"id":"e27","labels":{"sv":"E27","en":"E27"},"sort":1},{"id":"e14","labels":{"sv":"E14","en":"E14"},"sort":2},{"id":"gu10","labels":{"sv":"GU10","en":"GU10"},"sort":3},{"id":"g9","labels":{"sv":"G9","en":"G9"},"sort":4},{"id":"integrated","labels":{"sv":"Inbyggd LED","en":"Integrated LED"},"sort":5}]'::jsonb,'{"sv":"Sockel","en":"Socket"}'::jsonb,'{}'::jsonb),
 (null,'max_wattage',1,'number','W','[]'::jsonb,'{"sv":"Max effekt","en":"Maximum wattage"}'::jsonb,'{"sv":"Den högsta lampeffekt armaturen tål, inte effekten hos lampan som sitter i.","en":"The highest bulb wattage the fitting takes, not the wattage of the bulb in it."}'::jsonb),
 (null,'dimmable',1,'boolean','','[]'::jsonb,'{"sv":"Dimbar","en":"Dimmable"}'::jsonb,'{}'::jsonb);

insert into public.item_types(tenant_id,slug,labels,suggested_category) values
 (null,'sweater','{"sv":"Tröja","en":"Sweater"}'::jsonb,'Tröjor'),
 (null,'lamp','{"sv":"Lampa","en":"Lamp"}'::jsonb,'Belysning');

insert into public.item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort) values
 (null,'sweater','description',true,1),
 (null,'sweater','size',true,2),
 (null,'sweater','color',true,3),
 (null,'sweater','fit',false,4),
 (null,'sweater','brand',false,5),
 (null,'sweater','material',false,6),
 (null,'sweater','condition',true,7),
 (null,'lamp','description',true,1),
 (null,'lamp','socket',true,2),
 (null,'lamp','height_cm',false,3),
 (null,'lamp','color',false,4),
 (null,'lamp','material',false,5),
 (null,'lamp','max_wattage',false,6),
 (null,'lamp','dimmable',false,7),
 (null,'lamp','condition',true,8);
