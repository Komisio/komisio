-- Quick reception ids (hotfix 2026-09-15): the ids derived from the request
-- id were plain md5 digests, which are valid Postgres uuids but not RFC 4122
-- shaped; the application's readers validate ids as UUIDs and refused the
-- rows, which broke the items page for the store. Derived ids now carry the
-- version and variant nibbles of a random UUID. Rows already created keep
-- their ids; the readers accept any uuid the database hands back.
create function komisio_private.derived_uuid(p_text text) returns uuid language sql immutable set search_path='' as $$
 select overlay(overlay(md5(p_text) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
$$;
revoke all on function komisio_private.derived_uuid(text) from public,anon,authenticated;

create or replace function public.quick_receive(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); pol jsonb; sess public.reception_sessions; src public.reception_source_revisions; sources jsonb; price_source uuid; photo_source text;
 latest_review public.reception_reviews; agreement uuid; suggestions jsonb; metadata jsonb:='{}'::jsonb; k text; v text; review_id uuid; review_version integer; garment_id uuid; item_id uuid; existing public.items;
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
 for k in select * from jsonb_object_keys(p_facts) loop
  if k not in ('description','category','color','brand','size','material','condition') or jsonb_typeof(p_facts->k)<>'string' then raise exception 'INVALID_INPUT'; end if;
 end loop;
 price_source:=komisio_private.derived_uuid(p_request::text||':price');
 sources:=coalesce(src.sources,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',price_source::text,'kind','price-evidence','reference','Staff','observation','Quick reception: price set by staff'));
 perform public.save_reception_sources(p_tenant,komisio_private.derived_uuid(p_request::text||':sources'),p_session,p_expected,sources);
 select value->>'id' into photo_source from jsonb_array_elements(sources) value where value->>'kind'='photo' limit 1;
 for k in select * from jsonb_object_keys(p_facts) loop
  v:=trim(p_facts->>k);
  if v='' then continue; end if;
  if length(v)>1000 then raise exception 'INVALID_INPUT'; end if;
  metadata:=metadata||jsonb_build_object(k,jsonb_build_object('value',v,'sourceIds',jsonb_build_array(coalesce(photo_source,price_source::text)),'certainty','observed'));
 end loop;
 if not (metadata ? 'description') then raise exception 'INVALID_INPUT'; end if;
 suggestions:=jsonb_build_object('metadata',metadata,
  'price',jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'amount',to_char(p_price_ore/100.0,'FM999999990.00'),'rationale','Set by staff at quick reception','sourceIds',jsonb_build_array(price_source::text)),
  'questions','[]'::jsonb);
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 select * into latest_review from public.reception_reviews where tenant_id=p_tenant and session_id=p_session order by version desc limit 1;
 review_id:=public.publish_reception_review(p_tenant,komisio_private.derived_uuid(p_request::text||':review'),p_session,p_expected+1,latest_review.id,agreement,suggestions,now()+interval '1 day');
 select version into review_version from public.reception_reviews where id=review_id;
 garment_id:=public.receive_garment(p_tenant,komisio_private.derived_uuid(p_request::text||':garment'),p_session,'');
 item_id:=public.accept_item(p_tenant,komisio_private.derived_uuid(p_request::text||':item'),'reception_review',p_session,review_version,p_price_ore);
 perform komisio_private.record_access(p_tenant,'item.quick_received',item_id,jsonb_build_object('session_id',p_session,'price_ore',p_price_ore,'photo',photo_source is not null));
 return jsonb_build_object('itemId',item_id,'reference','I-'||upper(left(item_id::text,8)),'sessionId',p_session,'garmentId',garment_id,'reviewVersion',review_version);
end $$;
