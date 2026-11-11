-- Price meaning is part of immutable request evidence, including exact retries.
alter table public.external_item_requests add column price_basis text not null default 'resale' check(price_basis in ('resale','seller_amount'));
create function public.submit_external_item_request(
 p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,
 p_price_ore numeric,p_currency text,p_photos uuid[],p_sender_country text,p_price_basis text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); prior public.external_item_requests; policy jsonb;
 d text:=btrim(p_description); b text:=btrim(p_brand); n text:=btrim(p_notes);
begin
 if p_price_basis is null or p_price_basis not in ('resale','seller_amount') or p_id is null or p_tenant is null or d is null or length(d) not between 1 and 160
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
   or prior.price_basis<>p_price_basis or prior.currency<>p_currency or prior.photos<>p_photos or prior.sender_country is distinct from p_sender_country then raise exception 'REQUEST_CONFLICT'; end if;
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
 insert into public.external_item_requests(id,owner_id,tenant_id,description,brand,condition,notes,desired_price_ore,currency,photos,sender_country,price_basis)
 values(p_id,uid,p_tenant,d,b,p_condition,n,p_price_ore,p_currency,p_photos,p_sender_country,p_price_basis);
 return p_id;
end $$;


create or replace function public.submit_external_item_request(
 p_id uuid,p_tenant uuid,p_description text,p_brand text,p_condition text,p_notes text,
 p_price_ore numeric,p_currency text,p_photos uuid[],p_sender_country text
) returns uuid language sql security definer set search_path='' as $$
 select public.submit_external_item_request(p_id,p_tenant,p_description,p_brand,p_condition,p_notes,p_price_ore,p_currency,p_photos,p_sender_country,'resale');
$$;
revoke all on function public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text) from public,anon;
grant execute on function public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text) to authenticated;

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
   r.desired_price_ore::text,r.price_basis,r.currency,r.photos,r.created_at,r.sender_country,
   case when d.id is null then 'waiting' else 'declined' end as status,d.note as decline_note
  from public.external_item_requests r join public.tenants t on t.id=r.tenant_id
  left join public.external_item_request_declines d on d.request_id=r.id
  where r.owner_id=uid and (p_id is null or r.id=p_id)
  order by r.created_at desc,r.id limit 26 offset p_offset
 ) x;
 return jsonb_build_object('activeCount',active,'hasMore',jsonb_array_length(rows)>25,
  'requests',(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(rows) with ordinality e(value,ord) where ord<=25));
end $$;

create or replace function public.external_item_offer_queue(p_tenant uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); rows jsonb; total bigint;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into total from public.external_item_requests where tenant_id=p_tenant;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') into rows from (
  select r.id,r.owner_id,r.description,r.brand,r.condition,r.notes,r.currency,case when r.price_basis='seller_amount' then r.desired_price_ore::text end as desired_price_ore,r.photos,r.created_at,
   d.note as decline_note,d.id is not null as declined,
   coalesce(r.agreement_version_id,o.agreement_version_id,(select id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1)) as agreement_version_id,
   case when o.id is null then null else public.read_external_item_offer(o.id)-'agreement' end as offer
  from public.external_item_requests r
  left join public.external_item_request_declines d on d.request_id=r.id
  left join lateral (select x.id,x.agreement_version_id from public.external_item_offers x where x.request_id=r.id order by x.created_at desc,x.id limit 1) o on true
  where r.tenant_id=p_tenant order by r.created_at desc,r.id limit 25 offset p_offset
 ) q;
 return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function public.external_item_offer_queue(uuid,integer) from public,anon,authenticated;
grant execute on function public.external_item_offer_queue(uuid,integer) to authenticated;
