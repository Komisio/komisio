create or replace function komisio_private.valid_item_attributes(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; slugs text[]:='{}';
begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 if jsonb_array_length(value)>100 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' then return false; end if;
  if not(item ?& array['slug','definitionVersion','value','sourceIds','certainty'])
   or (item-array['slug','definitionVersion','value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(item->'slug')<>'string' or (item->>'slug') !~ '^[a-z][a-z0-9_]{0,39}$' then return false; end if;
  if jsonb_typeof(item->'definitionVersion')<>'number' or (item->>'definitionVersion')::numeric<1
   or (item->>'definitionVersion')::numeric<>trunc((item->>'definitionVersion')::numeric) then return false; end if;
  if jsonb_typeof(item->'value')<>'string' or length(trim(item->>'value')) not between 1 and 1000 or length(item->>'value')>1000 then return false; end if;
  -- A published review states what was observed. A guess is held for review
  -- before it gets here, exactly as the seven fixed facts already are.
  if item->>'certainty' is distinct from 'observed' then return false; end if;
  -- Shape only. An inspection draft has no sources to cite, so an empty list
  -- is valid here; a published review demands one and says so itself.
  if jsonb_typeof(item->'sourceIds')<>'array' then return false; end if;
  if jsonb_array_length(item->'sourceIds')>0 and not komisio_private.valid_reception_refs(item->'sourceIds') then return false; end if;
  if (item->>'slug')=any(slugs) then return false; end if;
  slugs:=slugs||(item->>'slug');
 end loop;
 return true;
end $$;

-- A chain transfer carries the whole description (2026-09-17, fifth slice).
-- Colour, brand, size and material were lost the moment an item moved between
-- two stores of one company, because the target receives an inspection draft
-- and that table had three descriptive columns while a reception review has a
-- list. The draft carries the list now, so the transfer copies what the item
-- is rather than the part that happened to fit.
--
-- The three columns stay: they hold real data, they are the first three
-- well-known slugs, and the seam prefers the list only when there is one.
alter table public.inspection_draft_revisions
 add column attributes jsonb not null default '[]'::jsonb
 check(komisio_private.valid_item_attributes(attributes));

create or replace function public.save_inspection_draft(p_tenant uuid,p_request uuid,p_bag uuid,p_draft uuid,p_expected integer,p_description text,p_category text,p_condition text,p_attributes jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.inspection_draft_revisions;
 latest public.inspection_draft_revisions; d text:=trim(p_description); c text:=trim(p_category); n text:=trim(p_condition); attrs jsonb:=coalesce(p_attributes,'[]'::jsonb); a jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_bag is null or p_draft is null or p_expected is null or p_expected<0 or p_expected>=2147483647
 or d is null or length(d) not between 1 and 1000 or c is null or length(c)>120 or n is null or length(n)>500
 or not komisio_private.valid_item_attributes(attrs) then raise exception 'INVALID_INPUT'; end if;
 for a in select * from jsonb_array_elements(attrs) loop
  if not exists(select 1 from public.attribute_definitions f where f.slug=a->>'slug' and f.version=(a->>'definitionVersion')::integer
   and (f.tenant_id is null or f.tenant_id=p_tenant)) then raise exception 'ATTRIBUTE_UNDEFINED'; end if;
 end loop;
 select * into previous from public.inspection_draft_revisions where id=p_request;
 if found then
  if previous.archived or previous.change_reason<>'' or previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.bag_id is distinct from p_bag or previous.draft_id is distinct from p_draft or previous.revision is distinct from p_expected+1
  or previous.description is distinct from d or previous.category is distinct from c or previous.condition is distinct from n
  or previous.attributes is distinct from attrs then raise exception 'REQUEST_CONFLICT'; end if;
  return p_request;
 end if;
 if not exists(select 1 from public.bag_receipts where id=p_bag and tenant_id=p_tenant) then raise exception 'BAG_NOT_FOUND'; end if;
 select * into latest from public.inspection_draft_revisions where draft_id=p_draft order by revision desc limit 1;
 if found and (latest.tenant_id is distinct from p_tenant or latest.bag_id is distinct from p_bag) then raise exception 'INSPECTION_CONTEXT_CHANGED'; end if;
 if coalesce(latest.revision,0)<>p_expected then raise exception 'INSPECTION_DRAFT_CHANGED'; end if;
 if latest.archived then raise exception 'INSPECTION_ARCHIVED'; end if;
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,attributes,created_by)
 values(p_request,p_tenant,p_bag,p_draft,p_expected+1,d,c,n,attrs,uid);
 perform komisio_private.record_access(p_tenant,'inspection.saved',p_draft,jsonb_build_object('revision',p_expected+1,'bag_id',p_bag));
 return p_request;
end $$;

drop function if exists public.save_inspection_draft(uuid,uuid,uuid,uuid,integer,text,text,text);
revoke all on function public.save_inspection_draft(uuid,uuid,uuid,uuid,integer,text,text,text,jsonb) from public,anon;
grant execute on function public.save_inspection_draft(uuid,uuid,uuid,uuid,integer,text,text,text,jsonb) to authenticated;

create or replace function komisio_private.item_attributes(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; out jsonb:='[]'::jsonb; d record; note text; merged jsonb:='[]'::jsonb; a jsonb; c record; seen text[]:='{}';
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return '[]'::jsonb; end if;
 if item.origin_kind='reception_review' then
  select coalesce(suggestions->'attributes',komisio_private.metadata_to_attributes(suggestions->'metadata')) into out
   from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 elsif item.origin_kind='inspection_draft' then
  select description,category,condition,attributes into d from public.inspection_draft_revisions
   where tenant_id=p_tenant and draft_id=item.origin_id and revision=item.origin_revision;
  -- A draft written with a list keeps it; one written before the column
  -- existed still answers with its three columns.
  if jsonb_array_length(coalesce(d.attributes,'[]'::jsonb))>0 then
   out:=d.attributes;
  else
   out:=(select coalesce(jsonb_agg(jsonb_build_object('slug',s,'definitionVersion',1,'value',v,'sourceIds','[]'::jsonb,'certainty','observed')),'[]'::jsonb)
         from (values('description',d.description),('category',d.category),('condition',d.condition)) as f(s,v)
         where nullif(trim(coalesce(v,'')),'') is not null);
  end if;
 else
  select supplier_note into note from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
  if nullif(trim(coalesce(note,'')),'') is not null then
   out:=jsonb_build_array(jsonb_build_object('slug','description','definitionVersion',1,'value',note,'sourceIds','[]'::jsonb,'certainty','observed'));
  end if;
 end if;
 out:=coalesce(out,'[]'::jsonb);
 for a in select * from jsonb_array_elements(out) loop
  select * into c from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and k.slug=a->>'slug'
   order by k.seq desc limit 1;
  if found then
   merged:=merged||jsonb_build_array(a||jsonb_build_object('value',c.value,'definitionVersion',c.definition_version,'source','corrected',
    'accepted',jsonb_build_object('value',a->>'value','at',item.accepted_at),
    'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
  else
   merged:=merged||jsonb_build_array(a||jsonb_build_object('source','accepted'));
  end if;
  seen:=seen||(a->>'slug');
 end loop;
 -- A correction may also add something the reception never recorded, such as a
 -- socket nobody noted at the counter.
 for c in select distinct on (k.slug) k.* from public.item_attribute_corrections k
   where k.tenant_id=p_tenant and k.item_id=p_item and not(k.slug=any(seen))
   order by k.slug, k.seq desc loop
  merged:=merged||jsonb_build_array(jsonb_build_object('slug',c.slug,'definitionVersion',c.definition_version,'value',c.value,
   'sourceIds','[]'::jsonb,'certainty','observed','source','corrected','accepted',null,
   'correctedBy',c.corrected_by,'correctedAt',c.corrected_at,'reason',c.reason));
 end loop;
 return merged;
end $$;

create or replace function public.transfer_item(p_from uuid,p_item uuid,p_to uuid,p_id uuid,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,'')); item public.items; src public.sellers; dst uuid;
 chain_from uuid; chain_to uuid; from_name text; facts jsonb; prior public.item_events; bag uuid; draft uuid; origin jsonb; title text; category text; cond text; carried jsonb;
 detail jsonb; first uuid; second uuid;
begin
 if p_from is null or p_to is null or p_item is null or p_id is null or p_from=p_to or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Lock both stores in a fixed order so two opposite transfers cannot deadlock.
 if p_from<p_to then first:=p_from; second:=p_to; else first:=p_to; second:=p_from; end if;
 perform 1 from public.tenants where id=first for update;
 perform 1 from public.tenants where id=second for update;
 if coalesce(public.tenant_role(p_from),'') not in ('owner','admin') or coalesce(public.tenant_role(p_to),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select chain_id,name into chain_from,from_name from public.tenants where id=p_from;
 select chain_id into chain_to from public.tenants where id=p_to;
 if chain_from is null or chain_to is distinct from chain_from then raise exception 'NOT_SAME_CHAIN'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id<>p_from or prior.item_id<>p_item or prior.kind<>'period_ended' or prior.actor<>uid or prior.detail->>'action' is distinct from 'transfer' then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('transferred',true,'replayed',true,'toTenant',prior.detail->>'toTenant','sellerId',prior.detail->>'sellerId','bagId',prior.detail->>'bagId','draftId',prior.detail->>'draftId');
 end if;
 select * into item from public.items where tenant_id=p_from and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.ownership<>'consignment' or item.seller_id is null then raise exception 'TRANSFER_UNSUPPORTED'; end if;
 facts:=komisio_private.item_lifecycle(p_from,p_item);
 if (facts->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (facts->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 select * into src from public.sellers where tenant_id=p_from and id=item.seller_id;
 -- The same person in the target store: matched by e-mail, else by phone; otherwise copied.
 if src.email<>'' then select id into dst from public.sellers where tenant_id=p_to and lower(email)=lower(src.email) order by created_at limit 1; end if;
 if dst is null and src.phone<>'' then select id into dst from public.sellers where tenant_id=p_to and phone=src.phone order by created_at limit 1; end if;
 if dst is null then
  dst:=gen_random_uuid();
  insert into public.sellers(id,tenant_id,name,email,phone,created_by) values(dst,p_to,src.name,src.email,src.phone,uid);
  perform komisio_private.record_access(p_to,'seller.registered',dst,jsonb_build_object('via','transfer','from_tenant',p_from));
 end if;
 origin:=komisio_private.item_title(p_from,p_item);
 title:=coalesce(origin->>'title','Transferred item');
 category:=coalesce(origin->>'category','');
 cond:=coalesce(origin->>'condition','');
 -- Everything the item is described as, not the part that fitted three
 -- columns. The accepted value is what travels: a correction belongs to the
 -- item it was made on, and the target store inspects the garment itself.
 carried:=(select coalesce(jsonb_agg(a-'source'-'accepted'-'correctedBy'-'correctedAt'-'reason'),'[]'::jsonb)
  from jsonb_array_elements(komisio_private.item_attributes(p_from,p_item)) a
  where exists(select 1 from public.attribute_definitions f where f.slug=a->>'slug' and f.version=(a->>'definitionVersion')::integer and (f.tenant_id is null or f.tenant_id=p_to)));
 bag:=gen_random_uuid(); draft:=gen_random_uuid();
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by)
 values(bag,p_to,dst,left('Transfer from '||from_name||' (item '||p_item::text||')'||case when note<>'' then ': '||note else '' end,500),uid);
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,attributes,created_by)
 values(gen_random_uuid(),p_to,bag,draft,1,left(title,1000),left(category,120),left(cond,500),carried,uid);
 detail:=jsonb_build_object('action','transfer','note',note,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_from,p_item,'period_ended',detail,uid);
 perform komisio_private.record_access(p_from,'item.transferred_out',p_item,jsonb_build_object('to_tenant',p_to,'bag_id',bag));
 perform komisio_private.record_access(p_to,'item.transferred_in',bag,jsonb_build_object('from_tenant',p_from,'item_id',p_item,'draft_id',draft));
 return jsonb_build_object('transferred',true,'replayed',false,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
end $$;

create or replace function komisio_private.valid_reception_review(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare metadata jsonb; price jsonb; fact jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['metadata','price','questions']) or (value-array['metadata','price','questions','attributes','itemType'])<>'{}'::jsonb then return false; end if;
 if value->'questions'<>'[]'::jsonb then return false; end if;
 if value ? 'itemType' and (jsonb_typeof(value->'itemType')<>'string' or (value->>'itemType') !~ '^[a-z][a-z0-9_]{0,39}$') then return false; end if;
 if value ? 'attributes' then
  if not komisio_private.valid_item_attributes(value->'attributes') then return false; end if;
  -- Publication is where evidence is required: every observation a seller is
  -- asked to approve cites the photo or the note it came from.
  if exists(select 1 from jsonb_array_elements(value->'attributes') a where not komisio_private.valid_reception_refs(a->'sourceIds')) then return false; end if;
 end if;
 metadata:=value->'metadata'; price:=value->'price';
 if jsonb_typeof(metadata)<>'object' or jsonb_typeof(price)<>'object' then return false; end if;
 -- metadata never holds a key outside the seven it was built for, which is
 -- what keeps an unknown key an INVALID_INPUT rather than a silent drop.
 if (metadata-komisio_private.legacy_metadata_slugs())<>'{}'::jsonb then return false; end if;
 -- A description is required, but a caller that sends the list puts it there
 -- and leaves metadata for the derivation to fill.
 if value ? 'attributes' then
  if not exists(select 1 from jsonb_array_elements(value->'attributes') a where a->>'slug'='description') then return false; end if;
  -- A caller that sends both must send them agreeing. Silently letting the
  -- list win would turn an edit of the derived field into a no-op, which is
  -- exactly the two-sources-of-truth failure the list exists to prevent.
  if metadata<>'{}'::jsonb and metadata<>komisio_private.attributes_to_metadata(value->'attributes') then return false; end if;
 elsif not(metadata ? 'description') then
  return false;
 end if;
 for fact in select v from jsonb_each(metadata) as fields(k,v) loop
  if jsonb_typeof(fact)<>'object' then return false; end if;
  if not(fact ?& array['value','sourceIds','certainty']) or (fact-array['value','sourceIds','certainty'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(fact->'value')<>'string' or length(trim(fact->>'value')) not between 1 and 1000 or length(fact->>'value')>1000
   or fact->>'certainty' is distinct from 'observed' or not komisio_private.valid_reception_refs(fact->'sourceIds') then return false; end if;
 end loop;
 if not(price ?& array['currency','amount','rationale','sourceIds']) or (price-array['currency','amount','rationale','sourceIds'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(price->'currency')<>'string' or price->>'currency' not in ('SEK','NOK','DKK','EUR') or jsonb_typeof(price->'amount')<>'string'
  or (price->>'amount') !~ '^(0|[1-9][0-9]{0,5})\.[0-9]{2}$' or price->>'amount'='0.00'
  or jsonb_typeof(price->'rationale')<>'string' or length(trim(price->>'rationale')) not between 1 and 2000 or length(price->>'rationale')>2000
  or not komisio_private.valid_reception_refs(price->'sourceIds') then return false; end if;
 return true;
end $$;
