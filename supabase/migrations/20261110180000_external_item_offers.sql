-- Central offers are immutable promises, separate from custody and ledger facts.
alter table public.external_item_requests
 add column agreement_version_id uuid,
 add foreign key(tenant_id,agreement_version_id) references public.seller_agreement_versions(tenant_id,id),
 add unique(id,owner_id,tenant_id);

create function komisio_private.external_request_agreement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Capture new-upload terms without rewriting historical requests. Legacy
 -- requests with no snapshot will select their terms when the first offer issues.
 select id into new.agreement_version_id from public.seller_agreement_versions
  where tenant_id=new.tenant_id order by version desc limit 1;
 return new;
end $$;
create trigger external_request_agreement before insert on public.external_item_requests
 for each row execute function komisio_private.external_request_agreement();

create table public.external_item_offers (
 id uuid primary key,
 tenant_id uuid not null,
 request_id uuid not null,
 owner_id uuid not null,
 previous_offer_id uuid,
 seller_amount_ore numeric(11,0) not null check(seller_amount_ore between 1 and 99999999999),
 expected_sale_price_ore numeric(11,0) not null check(expected_sale_price_ore between 1 and 99999999999),
 currency text not null default 'SEK' check(currency='SEK'),
 agreement_version_id uuid not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 check(expires_at=created_at+interval '48 hours'),
 unique(tenant_id,id,owner_id),
 unique(request_id,id),
 foreign key(request_id,owner_id,tenant_id) references public.external_item_requests(id,owner_id,tenant_id),
 foreign key(request_id,previous_offer_id) references public.external_item_offers(request_id,id),
 foreign key(tenant_id,agreement_version_id) references public.seller_agreement_versions(tenant_id,id)
);
create table public.external_item_offer_responses (
 id uuid primary key,
 tenant_id uuid not null,
 offer_id uuid not null unique,
 owner_id uuid not null,
 accepted boolean not null,
 agreement_version_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 check((accepted and agreement_version_id is not null) or (not accepted and agreement_version_id is null)),
 foreign key(tenant_id,offer_id,owner_id) references public.external_item_offers(tenant_id,id,owner_id),
 foreign key(tenant_id,agreement_version_id) references public.seller_agreement_versions(tenant_id,id)
);
create index external_item_offers_request on public.external_item_offers(request_id,created_at desc,id);
create index external_item_offers_owner on public.external_item_offers(owner_id,created_at desc,id);

do $$ declare t text; begin
 foreach t in array array['external_item_offers','external_item_offer_responses'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create trigger immutable_record before update or delete on public.%I for each row execute function komisio_private.preserve_payout_event()',t);
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on public.%I for each statement execute function komisio_private.guard_support_write()',t);
  execute format('create trigger plan_gate before insert on public.%I for each row execute function komisio_private.plan_gate()',t);
  execute format('create policy own_or_staff_read on public.%I for select to authenticated using ((owner_id=auth.uid() and public.external_phone_verified()) or public.tenant_role(tenant_id) in (''owner'',''admin'',''staff'',''readonly''))',t);
 end loop;
end $$;

create function public.issue_external_item_offer(p_tenant uuid,p_id uuid,p_request uuid,p_previous uuid,p_amount_ore numeric,p_sale_price_ore numeric,p_agreement uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); req public.external_item_requests;
 prior public.external_item_offers; latest public.external_item_offers; agreement uuid; issued timestamptz;
begin
 if p_id is null or p_tenant is null or p_request is null or p_agreement is null
  or p_amount_ore is null or p_amount_ore not between 1 and 99999999999 or p_amount_ore<>trunc(p_amount_ore)
  or p_sale_price_ore is null or p_sale_price_ore not between 1 and 99999999999 or p_sale_price_ore<>trunc(p_sale_price_ore) then raise exception 'INVALID_INPUT'; end if;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into req from public.external_item_requests where id=p_request and tenant_id=p_tenant;
 if req.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform komisio_private.lock_external_owner(req.owner_id);
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into prior from public.external_item_offers where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.request_id<>p_request or prior.created_by<>uid
   or prior.previous_offer_id is distinct from p_previous or prior.seller_amount_ore<>p_amount_ore
   or prior.expected_sale_price_ore<>p_sale_price_ore or prior.agreement_version_id<>p_agreement then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if req.sender_country is distinct from 'SE' or req.currency<>'SEK' then raise exception 'STORE_UNAVAILABLE'; end if;
 if exists(select 1 from public.external_item_request_declines where request_id=p_request) then raise exception 'REQUEST_CHANGED'; end if;
 select * into latest from public.external_item_offers where request_id=p_request order by created_at desc,id limit 1;
 if latest.id is distinct from p_previous then raise exception 'REQUEST_CHANGED'; end if;
 if exists(select 1 from public.external_item_offer_responses where offer_id=latest.id and accepted) then raise exception 'OFFER_ACCEPTED'; end if;
 if latest.id is not null and latest.expires_at>clock_timestamp() then raise exception 'OFFER_ACTIVE'; end if;
 agreement:=coalesce(req.agreement_version_id,latest.agreement_version_id);
 if agreement is null then
  select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 end if;
 if agreement is null or agreement<>p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 issued:=clock_timestamp();
 insert into public.external_item_offers(id,tenant_id,request_id,owner_id,previous_offer_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at)
 values(p_id,p_tenant,p_request,req.owner_id,p_previous,p_amount_ore,p_sale_price_ore,p_agreement,uid,issued,issued+interval '48 hours');
 perform komisio_private.record_access(p_tenant,'external_offer.issued',p_id,jsonb_build_object('requestId',p_request,'agreementId',p_agreement));
 return p_id;
end $$;

create function komisio_private.guard_external_request_decline() returns trigger
language plpgsql security definer set search_path='' as $$
declare offer public.external_item_offers; answer public.external_item_offer_responses; own uuid;
begin
 select owner_id into own from public.external_item_requests where id=new.request_id and tenant_id=new.tenant_id;
 perform komisio_private.lock_external_owner(own);
 select * into offer from public.external_item_offers where request_id=new.request_id order by created_at desc,id limit 1;
 if offer.id is null then return new; end if;
 select * into answer from public.external_item_offer_responses where offer_id=offer.id;
 if answer.accepted then raise exception 'OFFER_ACCEPTED'; end if;
 if answer.id is null and offer.expires_at>clock_timestamp() then raise exception 'OFFER_ACTIVE'; end if;
 return new;
end $$;
create trigger external_offer_guard before insert on public.external_item_request_declines
 for each row execute function komisio_private.guard_external_request_decline();

create function public.respond_external_item_offer(p_id uuid,p_offer uuid,p_accepted boolean,p_agreement uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); offer public.external_item_offers;
 prior public.external_item_offer_responses; latest uuid;
begin
 if p_id is null or p_offer is null or p_accepted is null then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into offer from public.external_item_offers where id=p_offer and owner_id=uid;
 if offer.id is null then raise exception 'OFFER_NOT_FOUND'; end if;
 perform 1 from public.tenants where id=offer.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into prior from public.external_item_offer_responses where id=p_id;
 if found then
  if prior.offer_id<>p_offer or prior.owner_id<>uid or prior.accepted<>p_accepted or prior.agreement_version_id is distinct from p_agreement then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.external_item_offer_responses where offer_id=p_offer)
  or exists(select 1 from public.external_item_request_declines where request_id=offer.request_id) then raise exception 'REQUEST_CHANGED'; end if;
 select id into latest from public.external_item_offers where request_id=offer.request_id order by created_at desc,id limit 1;
 if latest<>p_offer then raise exception 'REQUEST_CHANGED'; end if;
 if p_accepted and offer.expires_at<=clock_timestamp() then raise exception 'OFFER_EXPIRED'; end if;
 if (p_accepted and p_agreement is distinct from offer.agreement_version_id)
  or (not p_accepted and p_agreement is not null) then raise exception 'AGREEMENT_CHANGED'; end if;
 insert into public.external_item_offer_responses(id,tenant_id,offer_id,owner_id,accepted,agreement_version_id)
 values(p_id,offer.tenant_id,p_offer,uid,p_accepted,p_agreement);
 if not p_accepted then
  -- Keep the existing list and ten-active quota compatible with older clients.
  -- The response records that this was the seller's refusal, not a staff review.
  insert into public.external_item_request_declines(id,tenant_id,request_id,note,created_by)
  values(p_id,offer.tenant_id,offer.request_id,'',uid);
 end if;
 perform komisio_private.record_access(offer.tenant_id,'external_offer.responded',p_id,jsonb_build_object('offerId',p_offer,'accepted',p_accepted));
 return p_id;
end $$;

revoke all on function komisio_private.external_request_agreement(),komisio_private.guard_external_request_decline() from public,anon,authenticated;
revoke all on function public.issue_external_item_offer(uuid,uuid,uuid,uuid,numeric,numeric,uuid),public.respond_external_item_offer(uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.issue_external_item_offer(uuid,uuid,uuid,uuid,numeric,numeric,uuid),public.respond_external_item_offer(uuid,uuid,boolean,uuid) to authenticated;
