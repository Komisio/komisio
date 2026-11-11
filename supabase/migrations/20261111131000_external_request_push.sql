-- Reuse installation consent and the claimed-once queue. Ordinary store facts
-- retain their email identity, seller FKs and independent store policy checks.
alter table komisio_private.seller_push_deliveries
 alter column seller_id drop not null, alter column item_id drop not null,
 alter column policy_version drop not null,
 add column request_id uuid, add column owner_id uuid,
 add constraint external_push_request_owner foreign key(request_id,owner_id,tenant_id)
 references public.external_item_requests(id,owner_id,tenant_id);
alter table komisio_private.seller_push_deliveries drop constraint seller_push_deliveries_kind_check;
alter table komisio_private.seller_push_deliveries add constraint seller_push_event_shape check (
 (kind in ('item_registered','item_sold') and seller_id is not null and item_id is not null and policy_version is not null and request_id is null and owner_id is null)
 or (kind in ('external_item_offered','external_item_declined') and seller_id is null and item_id is null and policy_version is null and request_id is not null and owner_id is not null)
);

create function komisio_private.external_push_session_valid(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
  and u.phone_confirmed_at is not null and nullif(u.phone,'') is not null and u.deleted_at is null
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true'
  and (not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified') or s.aal='aal2'))
$$;
create function komisio_private.push_device_session_valid(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select komisio_private.push_session_valid(p_user,p_session) or komisio_private.external_push_session_valid(p_user,p_session)
$$;
create or replace function komisio_private.require_push_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid;
begin
 if public.external_phone_verified() then uid:=auth.uid();
 else uid:=komisio_private.require_identity(); end if;
 if exists(select 1 from auth.users where id=uid and raw_app_meta_data->>'komisio_password_recovery_pending'='true')
 then raise exception 'PASSWORD_UPDATE_REQUIRED' using errcode='42501'; end if;
 return uid;
end $$;

-- Only installation operations accept phone sessions. Do not replace the
-- email-only session predicate inside ordinary item/sale notification checks.
do $$ declare definition text; original text; signature text; begin
 foreach signature in array array['public.my_push_device(uuid,text)','public.set_my_push_device(uuid,text,uuid,integer,text,text,text,boolean)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(original,'komisio_private.push_session_valid(', 'komisio_private.push_device_session_valid(');
  if definition=original then raise exception 'MISSING_PUSH_SESSION_GUARD'; end if;
  if signature like 'public.set_%' then
   original:=definition;
   definition:=replace(definition,
    'if p_enabled and not exists(select 1 from komisio_private.email_identified_sellers s join auth.users u on u.id=uid',
    $replacement$if p_enabled and not (public.external_phone_verified() and exists(select 1 from public.external_item_requests r where r.owner_id=uid and r.sender_country='SE'))
     and not exists(select 1 from komisio_private.email_identified_sellers s join auth.users u on u.id=uid and u.email_confirmed_at is not null$replacement$);
   if definition=original then raise exception 'MISSING_PUSH_ACCOUNT_GUARD'; end if;
  end if;
  execute definition;
 end loop;
end $$;

create function komisio_private.enqueue_external_request_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare req public.external_item_requests; event_kind text;
begin
 select * into req from public.external_item_requests where id=new.request_id;
 if req.sender_country is distinct from 'SE' or req.tenant_id is distinct from
  (select central_app_tenant_id from public.platform_settings where only_row) then return new; end if;
 if tg_table_name='external_item_offers' then event_kind:='external_item_offered';
 else
  -- A seller declining an offer creates closure evidence too; do not notify
  -- them that the store rejected their item when they made the decision.
  if new.created_by=req.owner_id then return new; end if;
  event_kind:='external_item_declined';
 end if;
 insert into komisio_private.seller_push_deliveries(tenant_id,request_id,owner_id,device_id,device_generation,kind,reference_id)
 select req.tenant_id,req.id,req.owner_id,d.id,d.generation,event_kind,new.id
 from komisio_private.seller_push_devices d
 where d.user_id=req.owner_id and d.enabled
  and komisio_private.external_push_session_valid(d.user_id,d.session_id)
 on conflict(device_id,device_generation,kind,reference_id) do nothing;
 return new;
end $$;
create constraint trigger external_offer_push after insert on public.external_item_offers deferrable initially deferred
 for each row execute function komisio_private.enqueue_external_request_push();
create constraint trigger external_decline_push after insert on public.external_item_request_declines deferrable initially deferred
 for each row execute function komisio_private.enqueue_external_request_push();

create function komisio_private.external_push_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from komisio_private.seller_push_deliveries q
  join komisio_private.seller_push_devices d on d.id=q.device_id and d.generation=q.device_generation and d.user_id=q.owner_id
  join public.external_item_requests r on r.id=q.request_id and r.owner_id=q.owner_id and r.tenant_id=q.tenant_id
  join public.platform_settings p on p.only_row and p.central_app_tenant_id=r.tenant_id
  where q.id=p_id and r.sender_country='SE' and d.enabled and komisio_private.external_push_session_valid(d.user_id,d.session_id)
  and ((q.kind='external_item_offered' and exists(select 1 from public.external_item_offers o
    where o.id=q.reference_id and o.request_id=r.id and o.expires_at>clock_timestamp()
    and not exists(select 1 from public.external_item_offer_responses a where a.offer_id=o.id)
    and not exists(select 1 from public.external_item_request_declines x where x.request_id=r.id)))
   or (q.kind='external_item_declined' and exists(select 1 from public.external_item_request_declines x
    where x.id=q.reference_id and x.request_id=r.id and x.created_by<>r.owner_id))))
$$;

-- The worker uses the same bounded poll, provider transport, receipts and
-- unknown-outcome rules for both event shapes. No historical backfill.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.seller_push_candidates()'::regprocedure);
 definition:=replace(definition,
  'q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",q.kind,',
  'q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",q.request_id as "requestId",q.owner_id as "ownerId",case when q.kind=''external_item_offered'' then q.reference_id end as "offerId",q.kind,');
 execute definition;
 definition:=pg_get_functiondef('public.claim_seller_push(uuid,text,text,text)'::regprocedure);
 definition:=replace(definition,'if not komisio_private.seller_push_eligible(p_id) then',
  'if not (case when q.request_id is null then komisio_private.seller_push_eligible(p_id) else komisio_private.external_push_eligible(p_id) end) then');
 definition:=replace(definition,'insert into public.seller_communications(', 'if q.request_id is null then insert into public.seller_communications(');
 definition:=replace(definition,'q.reference_id,uid);', 'q.reference_id,uid); end if;');
 definition:=replace(definition,$needle$'itemId',q.item_id,'title'$needle$, $replacement$'itemId',q.item_id,'requestId',q.request_id,'ownerId',q.owner_id,'offerId',case when q.kind='external_item_offered' then q.reference_id end,'title'$replacement$);
 execute definition;
end $$;
revoke all on function komisio_private.external_push_session_valid(uuid,uuid),komisio_private.push_device_session_valid(uuid,uuid),komisio_private.enqueue_external_request_push(),komisio_private.external_push_eligible(uuid) from public,anon,authenticated;
