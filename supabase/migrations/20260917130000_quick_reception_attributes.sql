-- Quick reception collects any attribute, not seven (2026-09-17, third slice).
-- A member of staff picks an item type and answers its questions: a lamp is
-- asked for its socket and its height, a sweater for its size and its fit.
-- The facts map is now slug to value for any attribute the store can see, and
-- the function builds the attribute list directly. metadata is left empty and
-- derived when the review is published, so the two are never written out of
-- step by this path either.
--
-- The item type is optional so a caller that has not moved keeps working.
--
-- Adding a parameter creates an overload rather than replacing the function,
-- and a seven-argument call would keep reaching the old body. The old one is
-- dropped, so there is one quick reception and not two that drift apart.
drop function if exists public.quick_receive(uuid,uuid,uuid,uuid,integer,jsonb,bigint);

create or replace function public.quick_receive(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_item_type text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; attrs jsonb:='[]'::jsonb; k text; v text; ver integer; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_seller is null or p_expected is null or p_expected<0 or p_expected>=2147483646
  or p_price_ore is null or p_price_ore<=0 or p_price_ore>99999999 or p_facts is null or jsonb_typeof(p_facts)<>'object' or not (p_facts ? 'description') then raise exception 'INVALID_INPUT'; end if;
 pol:=public.current_store_policy(p_tenant)->'policy';
 if coalesce(pol->>'intakeProfile','quick')='full' then raise exception 'INTAKE_PROFILE_FULL'; end if;
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
 if not exists(select 1 from jsonb_array_elements(attrs) a where a->>'slug'='description') then raise exception 'INVALID_INPUT'; end if;
 -- metadata stays empty; publish_reception_review derives it from the list so
 -- the two can never be written out of step.
 suggestions:=jsonb_build_object('attributes',attrs,'metadata','{}'::jsonb,
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
end $$;

revoke all on function public.quick_receive(uuid,uuid,uuid,uuid,integer,jsonb,bigint,text) from public,anon;
grant execute on function public.quick_receive(uuid,uuid,uuid,uuid,integer,jsonb,bigint,text) to authenticated;
