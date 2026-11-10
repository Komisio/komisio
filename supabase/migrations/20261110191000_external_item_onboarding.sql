-- Final seller consent creates ordinary seller/bank/evidence records and an
-- invited handover together. It neither establishes custody nor credits money.
create table public.external_item_handover_links (
 id uuid primary key,
 tenant_id uuid not null,
 owner_id uuid not null references auth.users(id),
 offer_id uuid not null unique,
 seller_id uuid not null,
 handover_id uuid not null,
 agreement_id uuid not null,
 evidence_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,offer_id,owner_id) references public.external_item_offers(tenant_id,id,owner_id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,handover_id) references public.seller_handovers(tenant_id,id),
 foreign key(tenant_id,agreement_id,seller_id,evidence_id) references public.seller_agreement_evidence(tenant_id,agreement_id,seller_id,id)
);
create index external_item_handover_group on public.external_item_handover_links(tenant_id,seller_id,agreement_id,handover_id);
alter table public.external_item_handover_links enable row level security;
revoke all on public.external_item_handover_links from public,anon,authenticated;
grant select on public.external_item_handover_links to authenticated;
create policy own_or_staff_read on public.external_item_handover_links for select to authenticated
 using((owner_id=auth.uid() and public.external_phone_verified()) or public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger immutable_record before update or delete on public.external_item_handover_links for each row execute function komisio_private.preserve_agreement_record();
create trigger support_read_only_guard before insert or update or delete or truncate on public.external_item_handover_links for each statement execute function komisio_private.guard_support_write();
create trigger plan_gate before insert on public.external_item_handover_links for each row execute function komisio_private.plan_gate();
create trigger open_seller before insert on public.external_item_handover_links for each row execute function komisio_private.require_open_seller_row();

create function public.complete_external_item_offer(p_id uuid,p_offer uuid,p_agreement uuid,p_profile jsonb,p_bank jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); offer public.external_item_offers; prior public.external_item_handover_links;
 seller public.sellers; bank public.seller_bank_versions; evidence uuid; handover uuid; phone text; digest text;
begin
 if p_id is null or p_offer is null or p_agreement is null then raise exception 'INVALID_INPUT'; end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('offer',p_offer,'agreement',p_agreement,'profile',p_profile,'bank',p_bank)::text,'UTF8')),'hex');
 perform komisio_private.lock_external_owner(uid);
 select * into offer from public.external_item_offers where id=p_offer and owner_id=uid;
 if offer.id is null then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 perform 1 from public.tenants where id=offer.tenant_id for update;
 perform komisio_private.external_phone_owner();
 select * into prior from public.external_item_handover_links where id=p_id;
 if found then
  if prior.owner_id<>uid or prior.offer_id<>p_offer or prior.payload_hash<>digest then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.external_item_handover_links where offer_id=p_offer) then raise exception 'REQUEST_CHANGED'; end if;
 if p_agreement<>offer.agreement_version_id then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into seller from public.sellers where tenant_id=offer.tenant_id and external_owner_id=uid;
 if seller.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 if seller.id is null and (p_profile is null or p_bank is null) then raise exception 'ACCOUNT_REQUIRED'; end if;
 if p_profile is not null and (jsonb_typeof(p_profile)<>'object' or (p_profile-array['name','email'])<>'{}'
  or not(p_profile ?& array['name','email']) or jsonb_typeof(p_profile->'name')<>'string' or jsonb_typeof(p_profile->'email')<>'string'
  or length(trim(p_profile->>'name')) not between 1 and 120 or length(trim(p_profile->>'email'))>254
  or trim(p_profile->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_INPUT'; end if;
 if p_bank is not null and (not komisio_private.valid_bank_details(p_bank) or p_bank->>'country'<>'SE' or p_bank->>'kind'<>'local'
  or length(trim(p_bank->>'routing'))=0) then raise exception 'INVALID_INPUT'; end if;
 -- Final consent is atomic with account creation. Earlier accepted offers may
 -- complete onboarding later; an unanswered offer must still be within 48h.
 if not exists(select 1 from public.external_item_offer_responses where offer_id=p_offer and accepted) then
  perform public.respond_external_item_offer(komisio_private.derived_id(p_id::text||':response'),p_offer,true,p_agreement);
 end if;
 if seller.id is null then
  select u.phone into phone from auth.users u where u.id=uid;
  insert into public.sellers(id,tenant_id,name,email,phone,created_by,external_owner_id)
  values(komisio_private.derived_id(p_id::text||':seller'),offer.tenant_id,trim(p_profile->>'name'),lower(trim(p_profile->>'email')),phone,uid,uid)
  returning * into seller;
  insert into public.seller_bank_versions(id,tenant_id,seller_id,details,created_by)
  values(komisio_private.derived_id(p_id::text||':bank'),offer.tenant_id,seller.id,p_bank,uid);
  perform komisio_private.record_access(offer.tenant_id,'seller.registered',seller.id,jsonb_build_object('source','central_app'));
 else
  select * into bank from public.seller_bank_versions where tenant_id=offer.tenant_id and seller_id=seller.id order by seq desc limit 1;
  if bank.id is null then raise exception 'ACCOUNT_REQUIRED'; end if;
  if (p_profile is not null and (seller.name<>trim(p_profile->>'name') or seller.email<>lower(trim(p_profile->>'email'))))
   or (p_bank is not null and p_bank<>bank.details) then raise exception 'REQUEST_CHANGED'; end if;
 end if;
 select id into evidence from public.seller_agreement_evidence where tenant_id=offer.tenant_id and seller_id=seller.id
  and agreement_id=p_agreement and recorded_by=uid order by recorded_at,id limit 1;
 if evidence is null then
  evidence:=komisio_private.derived_id(p_id::text||':agreement');
  insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,source)
  values(evidence,offer.tenant_id,p_agreement,seller.id,'Central app offer '||p_offer,uid,'seller_portal');
 end if;
 select h.id into handover from public.seller_handovers h join public.external_item_handover_links l on l.handover_id=h.id
  where h.tenant_id=offer.tenant_id and h.seller_id=seller.id and h.status='open' and l.agreement_id=p_agreement
  order by h.created_at,h.id limit 1;
 if handover is null then
  handover:=komisio_private.derived_id(p_id::text||':handover');
  insert into public.seller_handovers(id,tenant_id,seller_id,kind,estimated_items,note,created_by)
  values(handover,offer.tenant_id,seller.id,'bag',1,'',uid);
  insert into public.handover_events(id,tenant_id,handover_id,kind,actor)
  values(handover,offer.tenant_id,handover,'created',uid);
  perform komisio_private.record_access(offer.tenant_id,'handover.created',handover,jsonb_build_object('seller_id',seller.id,'source','central_app'));
 end if;
 insert into public.external_item_handover_links(id,tenant_id,owner_id,offer_id,seller_id,handover_id,agreement_id,evidence_id,payload_hash)
 values(p_id,offer.tenant_id,uid,p_offer,seller.id,handover,p_agreement,evidence,digest);
 return p_id;
end $$;

create function public.read_external_item_onboarding(p_offer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); offer public.external_item_offers; seller public.sellers;
 link public.external_item_handover_links; handover public.seller_handovers; items jsonb; phone text;
begin
 select * into offer from public.external_item_offers where id=p_offer and owner_id=uid;
 if offer.id is null then raise exception 'OFFER_NOT_FOUND' using errcode='42501'; end if;
 select * into seller from public.sellers where tenant_id=offer.tenant_id and external_owner_id=uid;
 if seller.privacy_closed_at is not null then raise exception 'SELLER_CLOSED'; end if;
 select u.phone into phone from auth.users u where u.id=uid;
 select * into link from public.external_item_handover_links where offer_id=p_offer and owner_id=uid;
 if link.id is not null then
  select * into handover from public.seller_handovers where id=link.handover_id and tenant_id=offer.tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('requestId',r.id,'offerId',o.id,'description',r.description,'brand',r.brand,'photoId',r.photos[1]) order by l.created_at,l.id),'[]') into items
   from public.external_item_handover_links l join public.external_item_offers o on o.id=l.offer_id
   join public.external_item_requests r on r.id=o.request_id where l.handover_id=handover.id and l.owner_id=uid;
 end if;
 return jsonb_build_object('offerId',offer.id,'tenantId',offer.tenant_id,'phone',phone,
  'store',coalesce((select jsonb_build_object('address',profile->'address','openingHours',profile->'openingHours') from public.store_profile_versions where tenant_id=offer.tenant_id order by version desc limit 1),jsonb_build_object('address',null,'openingHours','[]'::jsonb)),
  'account',case when seller.id is null then null else jsonb_build_object('id',seller.id,'name',seller.name,'email',seller.email,
   'hasBank',exists(select 1 from public.seller_bank_versions where tenant_id=offer.tenant_id and seller_id=seller.id)) end,
  'handover',case when handover.id is null then null else jsonb_build_object('id',handover.id,'reference','H-'||handover.reference,
   'status',handover.status,'receivedAt',handover.received_at,'itemCount',jsonb_array_length(items),'items',items) end);
end $$;
revoke all on function public.complete_external_item_offer(uuid,uuid,uuid,jsonb,jsonb),public.read_external_item_onboarding(uuid) from public,anon,authenticated;
grant execute on function public.complete_external_item_offer(uuid,uuid,uuid,jsonb,jsonb),public.read_external_item_onboarding(uuid) to authenticated;

-- Keep the ordinary staff receipt implementation intact for existing stores.
alter function public.receive_handover(uuid,uuid,uuid,text,text) rename to receive_handover_before_central;
alter function public.receive_handover_before_central(uuid,uuid,uuid,text,text) set schema komisio_private;
revoke all on function komisio_private.receive_handover_before_central(uuid,uuid,uuid,text,text) from public,anon,authenticated;
create function public.receive_handover(p_tenant uuid,p_id uuid,p_handover uuid,p_source text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); link public.external_item_handover_links; h public.seller_handovers;
 prior public.handover_events; bag uuid; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into link from public.external_item_handover_links where tenant_id=p_tenant and handover_id=p_handover order by created_at,id limit 1;
 if link.id is null then return komisio_private.receive_handover_before_central(p_tenant,p_id,p_handover,p_source,p_note); end if;
 if p_id is null or p_source is distinct from 'staff_receipt' or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into h from public.seller_handovers where tenant_id=p_tenant and id=p_handover;
 select * into prior from public.handover_events where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.handover_id<>p_handover or prior.kind<>'received' or prior.actor<>uid or prior.note<>n
   or h.custody_source is distinct from p_source then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if h.status<>'open' then raise exception 'HANDOVER_DECIDED'; end if;
 if exists(select 1 from public.external_item_handover_links where handover_id=p_handover and (seller_id<>h.seller_id or agreement_id<>link.agreement_id)) then raise exception 'AGREEMENT_CHANGED'; end if;
 bag:=komisio_private.derived_id(h.id::text||':received');
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by,agreement_version_id,agreement_evidence_id)
 values(bag,p_tenant,h.seller_id,case when n='' then 'H-'||h.reference else n end,uid,link.agreement_id,link.evidence_id);
 perform set_config('komisio.handover_transition','engine',true);
 update public.seller_handovers set status='received',received_bag_id=bag,received_at=clock_timestamp(),custody_source=p_source where id=h.id;
 perform set_config('komisio.handover_transition','',true);
 insert into public.handover_events(id,tenant_id,handover_id,kind,note,actor) values(p_id,p_tenant,h.id,'received',n,uid);
 perform komisio_private.record_access(p_tenant,'bag.received',bag,jsonb_build_object('agreement_id',link.agreement_id,'evidence_id',link.evidence_id));
 perform komisio_private.record_access(p_tenant,'handover.received',h.id,jsonb_build_object('bag_id',bag,'custody_source',p_source));
 return p_id;
end $$;
revoke all on function public.receive_handover(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.receive_handover(uuid,uuid,uuid,text,text) to authenticated;

-- Central groups have exact linked item counts; ordinary announcements retain
-- their original estimates. No immutable announcement is edited when grouped.
do $$ declare signature text; definition text; needle text:='''estimatedItems'',h.estimated_items'; begin
 foreach signature in array array['public.handover_queue(uuid)','public.handover_queue_page(uuid,text,text,integer)','public.my_handovers(uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(needle in definition)=0 then raise exception 'UNEXPECTED_HANDOVER_COUNT: %',signature; end if;
  execute replace(definition,needle,'''estimatedItems'',coalesce((select count(*) from public.external_item_handover_links l where l.handover_id=h.id having count(*)>0),h.estimated_items)');
 end loop;
end $$;

-- Until the dedicated guaranteed intake operation is available, ordinary
-- percentage-based acceptance must never turn these promises into different terms.
create function komisio_private.require_guaranteed_item_intake() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.sellers s where s.tenant_id=new.tenant_id and s.id=new.seller_id and s.external_owner_id is not null) then
  raise exception 'GUARANTEED_INTAKE_REQUIRED';
 end if;
 return new;
end $$;
revoke all on function komisio_private.require_guaranteed_item_intake() from public,anon,authenticated;
create trigger guaranteed_item_intake before insert on public.items for each row execute function komisio_private.require_guaranteed_item_intake();
