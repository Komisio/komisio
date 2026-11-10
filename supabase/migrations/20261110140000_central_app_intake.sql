-- One host-designated recipient; ordinary photo pre-review is independent.
alter table public.platform_settings
 add column central_app_tenant_id uuid references public.tenants(id),
 add column central_app_revision uuid not null default gen_random_uuid();
alter table public.external_item_requests
 add column sender_country text check(sender_country='SE');

create function public.host_central_app_intake() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_build_object('tenantId',central_app_tenant_id,'revision',central_app_revision)
  from public.platform_settings where only_row);
end $$;

create function public.set_central_app_intake(p_id uuid,p_expected uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_row public.platform_settings; policy jsonb; audit_tenant uuid;
begin
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_expected is null or p_id=p_expected then raise exception 'INVALID_INPUT'; end if;
 -- Match the existing support boundary, including requests that become no-ops.
 perform pg_advisory_xact_lock_shared(komisio_private.support_lock_key());
 if exists(select 1 from komisio_private.current_support_visit()) then raise exception 'SUPPORT_READ_ONLY' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('central-app-intake',0));
 select * into current_row from public.platform_settings where only_row for update;
 if current_row.central_app_revision=p_id then
  if current_row.central_app_tenant_id is distinct from p_tenant then raise exception 'REQUEST_CONFLICT'; end if;
  return public.host_central_app_intake();
 end if;
 if current_row.central_app_revision<>p_expected then raise exception 'REQUEST_CHANGED'; end if;
 if current_row.central_app_tenant_id is null and p_tenant is null then return public.host_central_app_intake(); end if;
 if p_tenant is not null then
  perform 1 from public.tenants where id=p_tenant for update;
  if not found or coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  policy:=public.current_store_policy(p_tenant)->'policy';
  if coalesce(policy->>'currency','SEK')<>'SEK' then raise exception 'SEK_REQUIRED'; end if;
  perform komisio_private.require_writable(p_tenant);
 end if;
 update public.platform_settings set central_app_tenant_id=p_tenant,central_app_revision=p_id,updated_at=statement_timestamp() where only_row;
 audit_tenant:=coalesce(p_tenant,current_row.central_app_tenant_id);
 perform komisio_private.record_access(audit_tenant,'central_app.recipient_changed',p_id,
  jsonb_build_object('previous',current_row.central_app_tenant_id,'recipient',p_tenant));
 return public.host_central_app_intake();
end $$;

create function public.public_central_app_recipient() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'name','Komisio','slug',t.slug,
  'city',nullif(p.profile#>>'{address,city}',''),'country','SE','currency','SEK')
 from public.platform_settings s join public.tenants t on t.id=s.central_app_tenant_id
 left join lateral (select profile from public.store_profile_versions where tenant_id=t.id order by version desc limit 1) p on true
 where s.only_row and coalesce(komisio_private.current_store_policy_core(t.id)#>>'{policy,currency}','SEK')='SEK';
$$;

-- Keep the old read contract bounded. A stale app cannot discover other stores
-- through a historical self-service flag, including direct RPC callers.
create or replace function public.public_external_app_stores(
 p_query text default '',p_limit integer default 25,p_offset integer default 0,p_tenant uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare recipient jsonb;
begin
 if p_query is null or length(p_query)>100 or p_limit is null or p_limit not between 1 and 50
  or p_offset is null or p_offset not between 0 and 10000 then raise exception 'INVALID_INPUT'; end if;
 recipient:=public.public_central_app_recipient();
 if recipient is null or p_offset>0 or (p_tenant is not null and p_tenant<>(recipient->>'id')::uuid)
  or (btrim(p_query)<>'' and position(lower(btrim(p_query)) in lower(recipient->>'name'))=0)
 then return jsonb_build_object('stores','[]'::jsonb,'hasMore',false); end if;
 return jsonb_build_object('stores',jsonb_build_array(recipient),'hasMore',false);
end $$;

revoke all on function public.host_central_app_intake(),public.set_central_app_intake(uuid,uuid,uuid),public.public_central_app_recipient() from public,anon,authenticated;
grant execute on function public.host_central_app_intake(),public.set_central_app_intake(uuid,uuid,uuid) to authenticated;
grant execute on function public.public_central_app_recipient() to anon,authenticated;

create function public.submit_external_item_request(
 p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,
 p_price_ore numeric,p_currency text,p_photos uuid[],p_sender_country text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); prior public.external_item_requests; policy jsonb;
 d text:=btrim(p_description); b text:=btrim(p_brand); n text:=btrim(p_notes);
begin
 if p_id is null or p_tenant is null or d is null or length(d) not between 1 and 160
  or b is null or length(b)>100 or n is null or length(n)>1000
  or p_condition is null or p_condition not in ('like_new','very_good','good','worn')
  or p_currency is null or p_currency !~ '^[A-Z]{3}$'
  or (p_price_ore is not null and (p_price_ore<1 or p_price_ore>99999999999 or p_price_ore<>trunc(p_price_ore)))
  or p_photos is null or cardinality(p_photos) not between 1 and 8
  or array_ndims(p_photos)<>1 or array_lower(p_photos,1)<>1
  or (select count(distinct x) from unnest(p_photos) x)<>cardinality(p_photos)
 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into prior from public.external_item_requests where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.tenant_id<>p_tenant or prior.description<>d or prior.brand<>b
   or prior.condition<>p_condition or prior.notes<>n or prior.desired_price_ore is distinct from p_price_ore
   or prior.currency<>p_currency or prior.photos<>p_photos or prior.sender_country is distinct from p_sender_country then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_sender_country is distinct from 'SE' then raise exception 'SWEDEN_REQUIRED'; end if;
 if p_currency<>'SEK' then raise exception 'STORE_CHANGED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 if p_tenant is distinct from (select central_app_tenant_id from public.platform_settings where only_row) then raise exception 'STORE_UNAVAILABLE'; end if;
 -- Recheck currency under the same tenant lock used for policy publication.
 perform 1 from public.tenants where id=p_tenant for update;
 select v.policy into policy from public.store_policy_versions v where tenant_id=p_tenant order by version desc limit 1;
 if coalesce(policy->>'currency','SEK')<>p_currency then raise exception 'STORE_CHANGED'; end if;
 if (select count(*) from public.external_item_requests r where owner_id=uid
  and not exists(select 1 from public.external_item_request_declines d where d.request_id=r.id))>=10 then raise exception 'ACTIVE_REQUEST_LIMIT'; end if;
 if (select count(*) from public.external_item_photos p where p.id=any(p_photos) and p.owner_id=uid and p.discarded_at is null
  and exists(select 1 from storage.objects o where o.bucket_id='external-item-photos' and o.name=p.path))<>cardinality(p_photos)
 then raise exception 'PHOTO_NOT_FOUND'; end if;
 insert into public.external_item_requests(id,owner_id,tenant_id,description,brand,condition,notes,desired_price_ore,currency,photos,sender_country)
 values(p_id,uid,p_tenant,d,b,p_condition,n,p_price_ore,p_currency,p_photos,p_sender_country);
 return p_id;
end $$;

-- Legacy callers can reconcile their original evidence but cannot create a new
-- request without explicitly declaring the supported intake country.
create or replace function public.submit_external_item_request(
 p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,
 p_price_ore numeric,p_currency text,p_photos uuid[]
) returns uuid language sql security definer set search_path='' as $$
 select public.submit_external_item_request(p_id,p_tenant,p_description,p_brand,p_condition,p_notes,p_price_ore,p_currency,p_photos,null);
$$;
revoke all on function public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text) from public,anon,authenticated;
grant execute on function public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text) to authenticated;

create or replace function public.my_external_item_requests(p_offset integer default 0,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); rows jsonb; active integer;
begin
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into active from public.external_item_requests r where r.owner_id=uid
  and not exists(select 1 from public.external_item_request_declines d where d.request_id=r.id);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into rows from (
  -- A retained SE declaration identifies the central flow introduced here.
  -- Preserve historical store names; central requests keep the product brand
  -- even after a host changes the recipient or the tenant is renamed.
  select r.id,r.tenant_id,case when r.sender_country='SE' then 'Komisio' else t.name end as store_name,r.description,r.brand,r.condition,r.notes,
   r.desired_price_ore::text,r.currency,r.photos,r.created_at,r.sender_country,
   case when d.id is null then 'waiting' else 'declined' end as status,d.note as decline_note
  from public.external_item_requests r join public.tenants t on t.id=r.tenant_id
  left join public.external_item_request_declines d on d.request_id=r.id
  where r.owner_id=uid and (p_id is null or r.id=p_id)
  order by r.created_at desc,r.id limit 26 offset p_offset
 ) x;
 return jsonb_build_object('activeCount',active,'hasMore',jsonb_array_length(rows)>25,
  'requests',(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(rows) with ordinality e(value,ord) where ord<=25));
end $$;
