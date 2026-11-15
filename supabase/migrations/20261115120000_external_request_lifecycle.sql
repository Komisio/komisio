-- Capacity follows immutable business evidence, not deletion or a cleanup cron.
alter table public.external_item_request_declines add column withdrawn boolean not null default false;

create function komisio_private.external_request_state(p_request uuid,p_at timestamptz default statement_timestamp()) returns text
language sql stable security definer set search_path='' as $$
 select case
  when d.withdrawn then 'withdrawn'
  when a.id is not null and not a.accepted then 'declined'
  when d.id is not null then 'rejected'
  when exists(select 1 from public.external_item_guarantee_events e where e.guarantee_id=g.id and e.kind='sold')
    or (facts.value->>'sold')::boolean then 'sold'
  when exists(select 1 from public.external_item_guarantee_events e where e.guarantee_id=g.id and e.kind='acquired') then 'acquired'
  when (facts.value->>'ended')::boolean then 'ended'
  when reg.item_id is not null then 'registered'
  when g.id is not null then 'received'
  when h.id is not null then h.status
  when a.accepted then 'accepted'
  when o.id is null then 'waiting'
  when o.expires_at<=p_at then 'expired'
  else 'offered' end
 from public.external_item_requests r
 left join public.external_item_request_declines d on d.request_id=r.id
 left join lateral (select x.id,x.expires_at from public.external_item_offers x where x.request_id=r.id order by x.created_at desc,x.id limit 1) o on true
 left join public.external_item_offer_responses a on a.offer_id=o.id
 left join public.external_item_handover_links l on l.offer_id=o.id
 left join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=r.tenant_id
 left join public.external_item_guarantees g on g.offer_id=o.id
 left join public.external_item_guarantee_events reg on reg.guarantee_id=g.id and reg.kind='registered'
 left join lateral (select case when reg.item_id is not null then komisio_private.item_lifecycle(r.tenant_id,reg.item_id) end as value) facts on true
 where r.id=p_request;
$$;
create function komisio_private.external_request_active(p_request uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select komisio_private.external_request_state(p_request) in ('waiting','offered','accepted','open','received','registered');
$$;
revoke all on function komisio_private.external_request_state(uuid,timestamptz),komisio_private.external_request_active(uuid) from public,anon,authenticated;

create function public.withdraw_external_item_request(p_id uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); req public.external_item_requests; prior public.external_item_request_declines;
begin
 if p_id is null or p_request is null then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into req from public.external_item_requests where id=p_request and owner_id=uid;
 if req.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform 1 from public.tenants where id=req.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into prior from public.external_item_request_declines where id=p_id;
 if found then
  if prior.request_id<>p_request or prior.created_by<>uid or not prior.withdrawn then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if req.sender_country is distinct from 'SE' or komisio_private.external_request_state(p_request,clock_timestamp()) is distinct from 'waiting'
 then raise exception 'REQUEST_CHANGED'; end if;
 insert into public.external_item_request_declines(id,tenant_id,request_id,note,created_by,withdrawn)
 values(p_id,req.tenant_id,req.id,'',uid,true);
 perform komisio_private.record_access(req.tenant_id,'external_request.withdrawn',p_id,jsonb_build_object('requestId',req.id));
 return p_id;
end $$;
revoke all on function public.withdraw_external_item_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.withdraw_external_item_request(uuid,uuid) to authenticated;

-- Preserve all existing submission validation and exact-retry paths.
do $$ declare definition text; needle text :=
 'if (select count(*) from public.external_item_requests r where owner_id=uid
  and not exists(select 1 from public.external_item_request_declines d where d.request_id=r.id))>=10 then raise exception ''ACTIVE_REQUEST_LIMIT''; end if;';
begin
 definition:=replace(pg_get_functiondef('public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text)'::regprocedure),E'\r','');
 needle:=replace(needle,E'\r','');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_SUBMISSION_QUOTA'; end if;
 execute replace(definition,needle,
  'if (select count(*) from public.external_item_requests r where owner_id=uid
   and komisio_private.external_request_active(r.id))>=30 then raise exception ''ACTIVE_REQUEST_LIMIT''; end if;');
end $$;

-- Once expiry has freed a slot, issuing a replacement must not silently consume it.
do $$ declare definition text; needle text := 'if latest.id is distinct from p_previous then raise exception ''REQUEST_CHANGED''; end if;';
begin
 definition:=replace(pg_get_functiondef('public.issue_external_item_offer(uuid,uuid,uuid,uuid,numeric,numeric,uuid)'::regprocedure),E'\r','');
 needle:=replace(needle,E'\r','');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_OFFER_ISSUE'; end if;
 execute replace(definition,needle,needle||'
 if komisio_private.external_request_state(p_request,clock_timestamp())=''expired'' then raise exception ''REQUEST_CHANGED''; end if;');
end $$;

create function public.my_external_item_requests_page(p_offset integer default 0,p_id uuid default null,p_group text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); result jsonb;
begin
 if p_offset is null or p_offset not between 0 and 100000 or p_group is null or p_group not in ('all','active','history') then raise exception 'INVALID_INPUT'; end if;
 with owned as materialized (
  select r.*,komisio_private.external_request_state(r.id) as lifecycle_status
  from public.external_item_requests r where r.owner_id=uid
 ), classified as materialized (
  select r.*,lifecycle_status in ('waiting','offered','accepted','open','received','registered') as active from owned r
 ), selected as (
  select * from classified r where (p_id is null or r.id=p_id)
   and (p_group='all' or (p_group='active' and active) or (p_group='history' and not active))
  order by created_at desc,id limit 26 offset p_offset
 ), rows as (
  select r.id,r.tenant_id,case when r.sender_country='SE' then 'Komisio' else t.name end as store_name,
   r.description,r.brand,r.condition,r.notes,r.desired_price_ore::text,r.price_basis,r.currency,r.photos,r.created_at,r.sender_country,
   case when d.id is null then 'waiting' else 'declined' end as status,d.note as decline_note,
   r.lifecycle_status as "lifecycleStatus",r.active,
   (r.lifecycle_status='waiting' and r.sender_country='SE') as "canWithdraw"
  from selected r join public.tenants t on t.id=r.tenant_id
  left join public.external_item_request_declines d on d.request_id=r.id
  order by r.created_at desc,r.id limit 25
 )
 select jsonb_build_object('activeCount',(select count(*) from classified where active),'activeLimit',30,
  'historyCount',(select count(*) from classified where not active),'hasMore',(select count(*)>25 from selected),
  'requests',coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc,id) from rows),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.my_external_item_requests(p_offset integer default 0,p_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.my_external_item_requests_page(p_offset,p_id,'all');
$$;
revoke all on function public.my_external_item_requests_page(integer,uuid,text) from public,anon,authenticated;
grant execute on function public.my_external_item_requests_page(integer,uuid,text) to authenticated;

create or replace function public.external_item_offer_queue_filtered(
 p_tenant uuid,p_offset integer default 0,p_status text default 'all',p_query text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset not between 0 and 100000 or p_query is null or length(p_query)>120
  or p_status is null or p_status not in ('all','waiting','offered','accepted','open','received','registered','expired','rejected','declined','cancelled','withdrawn','sold','acquired','ended')
 then raise exception 'INVALID_INPUT'; end if;
 with candidates as materialized (
  select r.*,d.note as decline_note,d.id is not null as declined,
   o.id as offer_id,o.agreement_version_id as offer_agreement_id,
   komisio_private.external_request_state(r.id) as queue_status
  from public.external_item_requests r
  left join public.external_item_request_declines d on d.request_id=r.id
  left join lateral (select x.id,x.agreement_version_id from public.external_item_offers x where x.request_id=r.id order by x.created_at desc,x.id limit 1) o on true
  where r.tenant_id=p_tenant and (btrim(p_query)='' or strpos(lower(r.description||' '||r.brand),lower(btrim(p_query)))>0)
 ), filtered as materialized (
  select * from candidates where p_status='all' or queue_status=p_status
 ), selected as (
  select * from filtered order by created_at desc,id limit 25 offset p_offset
 ), rows as (
  select r.id,r.owner_id,r.description,r.brand,r.condition,r.notes,r.currency,
   case when r.price_basis='seller_amount' then r.desired_price_ore::text end as desired_price_ore,
   r.photos,r.created_at,r.decline_note,r.declined,r.queue_status,
   coalesce(r.agreement_version_id,r.offer_agreement_id,(select id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1)) as agreement_version_id,
   case when r.offer_id is null then null else public.read_external_item_offer(r.offer_id)-'agreement' end as offer
  from selected r
 )
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(rows) order by created_at desc,id) from rows),'[]'::jsonb)) into result;
 return result;
end $$;
