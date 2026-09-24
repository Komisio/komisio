-- Explicitly registered receiver, without tenant memberships or a service-role key.
create table komisio_private.shopify_privacy_actors (
 user_id uuid primary key references auth.users(id)
);
revoke all on komisio_private.shopify_privacy_actors from public,anon,authenticated;
create function komisio_private.register_shopify_privacy_actor(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
 then raise exception 'INVALID_INPUT'; end if;
 insert into komisio_private.shopify_privacy_actors values(p_user) on conflict do nothing;
end $$;
revoke all on function komisio_private.register_shopify_privacy_actor(uuid) from public,anon,authenticated;

create table public.shopify_privacy_requests (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid references public.tenants(id),
 topic text not null check(topic in ('customers/data_request','customers/redact','shop/redact')),
 shop_domain text not null check(length(shop_domain)<=120 and shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 cipher jsonb not null check(jsonb_typeof(cipher)='object' and cipher ?& array['iv','tag','data'] and octet_length(cipher::text)<=400000),
 received_by uuid not null references auth.users(id),
 received_at timestamptz not null default clock_timestamp(),
 due_at timestamptz not null default (clock_timestamp()+interval '30 days'),
 unique nulls not distinct(topic,shop_domain,fingerprint,tenant_id)
);
create table public.shopify_privacy_events (
 id uuid primary key,
 request_id uuid not null references public.shopify_privacy_requests(id),
 previous_id uuid references public.shopify_privacy_events(id),
 status text not null check(status in ('processing','completed','retained')),
 note text not null check(length(trim(note)) between 1 and 1000),
 actor uuid not null references auth.users(id),
 occurred_at timestamptz not null default clock_timestamp(),
 unique nulls not distinct(request_id,previous_id)
);
create index shopify_privacy_tenant on public.shopify_privacy_requests(tenant_id,received_at,id);
create index shopify_privacy_event_request on public.shopify_privacy_events(request_id);
alter table public.shopify_privacy_requests enable row level security;
alter table public.shopify_privacy_events enable row level security;
revoke all on public.shopify_privacy_requests,public.shopify_privacy_events from public,anon,authenticated;
create policy shopify_privacy_owner on public.shopify_privacy_requests for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin') or public.is_platform_host());
create policy shopify_privacy_event_owner on public.shopify_privacy_events for select to authenticated
 using(exists(select 1 from public.shopify_privacy_requests r where r.id=request_id and
 (public.tenant_role(r.tenant_id) in ('owner','admin') or public.is_platform_host())));
create trigger shopify_privacy_requests_immutable before update or delete on public.shopify_privacy_requests for each row execute function komisio_private.preserve_payout_event();
create trigger shopify_privacy_events_immutable before update or delete on public.shopify_privacy_events for each row execute function komisio_private.preserve_payout_event();

-- The receiver authenticates Shopify's raw bytes before invoking this RPC.
-- Never accept a caller-supplied tenant. Unknown shops remain host-only work.
create function public.receive_shopify_privacy(p_topic text,p_shop text,p_fingerprint text,p_cipher jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); matched integer; tid uuid;
begin
 if not exists(select 1 from komisio_private.shopify_privacy_actors where user_id=uid)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_topic is null or p_topic not in ('customers/data_request','customers/redact','shop/redact')
 or p_shop is null or length(p_shop)>120 or p_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
 or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not(p_cipher ?& array['iv','tag','data']) or octet_length(p_cipher::text)>400000
 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('shopify-privacy:'||p_topic||':'||p_shop||':'||p_fingerprint,0));
 if exists(select 1 from public.shopify_privacy_requests where topic=p_topic and shop_domain=p_shop and fingerprint=p_fingerprint)
 then return jsonb_build_object('replayed',true); end if;
 matched:=0;
 for tid in select distinct tenant_id from public.shopify_connection_events
  where kind in ('connected','refreshed') and detail->>'shop_domain'=p_shop
 loop
  insert into public.shopify_privacy_requests(tenant_id,topic,shop_domain,fingerprint,cipher,received_by)
  values(tid,p_topic,p_shop,p_fingerprint,p_cipher);
  matched:=matched+1;
 end loop;
 if matched=0 then
  insert into public.shopify_privacy_requests(tenant_id,topic,shop_domain,fingerprint,cipher,received_by)
  values(null,p_topic,p_shop,p_fingerprint,p_cipher);
 end if;
 return jsonb_build_object('replayed',false,'matched',matched);
end $$;

create function public.shopify_privacy_queue(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() and (p_tenant is null or coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin'))
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(row_data order by received_at,id),'[]') from (
  select r.received_at,r.id,jsonb_build_object('id',r.id,'tenantId',r.tenant_id,'topic',r.topic,
   'shopDomain',r.shop_domain,'receivedAt',r.received_at,'dueAt',r.due_at,'cipher',r.cipher,
   'status',coalesce(e.status,'pending'),'revision',e.id,'history',(
    select coalesce(jsonb_agg(jsonb_build_object('status',h.status,'note',h.note,'actor',h.actor,'at',h.occurred_at) order by h.occurred_at,h.id),'[]')
    from public.shopify_privacy_events h where h.request_id=r.id)) row_data
  from public.shopify_privacy_requests r
  left join lateral (select h.id,h.status from public.shopify_privacy_events h where h.request_id=r.id
   and not exists(select 1 from public.shopify_privacy_events n where n.previous_id=h.id) limit 1) e on true
  where r.tenant_id is not distinct from p_tenant
 ) q);
end $$;

create function public.record_shopify_privacy_outcome(p_request uuid,p_previous uuid,p_id uuid,p_status text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); r public.shopify_privacy_requests; prior uuid; old_event public.shopify_privacy_events;
begin
 select * into r from public.shopify_privacy_requests where id=p_request for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Serialize with membership changes; the host path also uses verified_session().
 if r.tenant_id is not null then perform 1 from public.tenants where id=r.tenant_id for update; end if;
 if not public.is_platform_host() and coalesce(public.tenant_role(r.tenant_id),'') not in ('owner','admin')
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_status is null or p_status not in ('processing','completed','retained')
 or p_note is null or length(trim(p_note)) not between 1 and 1000 then raise exception 'INVALID_INPUT'; end if;
 select * into old_event from public.shopify_privacy_events where id=p_id;
 if found then
  if old_event.request_id<>p_request or old_event.previous_id is distinct from p_previous or old_event.status<>p_status
   or old_event.note<>trim(p_note) or old_event.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('status',old_event.status,'revision',old_event.id,'replayed',true);
 end if;
 select e.id into prior from public.shopify_privacy_events e where e.request_id=p_request
 and not exists(select 1 from public.shopify_privacy_events n where n.previous_id=e.id);
 if prior is distinct from p_previous then raise exception 'REQUEST_CONFLICT'; end if;
 insert into public.shopify_privacy_events(id,request_id,previous_id,status,note,actor)
 values(p_id,p_request,p_previous,p_status,trim(p_note),uid);
 return jsonb_build_object('status',p_status,'revision',p_id,'replayed',false);
end $$;
revoke all on function public.receive_shopify_privacy(text,text,text,jsonb),public.shopify_privacy_queue(uuid),public.record_shopify_privacy_outcome(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.receive_shopify_privacy(text,text,text,jsonb),public.shopify_privacy_queue(uuid),public.record_shopify_privacy_outcome(uuid,uuid,uuid,text,text) to authenticated;
