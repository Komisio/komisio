-- A link admits an authenticated application, never a store member or active seller.
create table public.seller_registration_links (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 action text not null check(action in ('enable','disable','rotate')),
 enabled boolean not null,
 token text unique check(token ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.seller_registration_links(tenant_id,id),
 check(enabled=(token is not null))
);
create table public.seller_registrations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 link_id uuid not null,
 user_id uuid not null references auth.users(id),
 name text not null,
 email text not null,
 phone text not null,
 agreement_id uuid not null,
 translation_id uuid,
 agreement_text jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),
 foreign key(tenant_id,link_id) references public.seller_registration_links(tenant_id,id),
 foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id),
 foreign key(tenant_id,agreement_id,translation_id) references public.seller_agreement_translations(tenant_id,agreement_id,id)
);
create index seller_registration_account on public.seller_registrations(user_id,tenant_id,created_at desc);
create index seller_registration_queue on public.seller_registrations(tenant_id,created_at,id);
create table public.seller_registration_reviews (
 id uuid primary key,
 tenant_id uuid not null,
 registration_id uuid not null unique,
 approved boolean not null,
 seller_id uuid,
 created_seller boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,registration_id) references public.seller_registrations(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 check(approved=(seller_id is not null)), check(not created_seller or approved)
);
alter table public.seller_registration_links enable row level security;
alter table public.seller_registrations enable row level security;
alter table public.seller_registration_reviews enable row level security;
revoke all on public.seller_registration_links,public.seller_registrations,public.seller_registration_reviews from public,anon,authenticated;
create trigger immutable_registration_link before update or delete on public.seller_registration_links
 for each row execute function komisio_private.preserve_agreement_record();
create trigger immutable_registration_review before update or delete on public.seller_registration_reviews
 for each row execute function komisio_private.preserve_agreement_record();

-- Extend the existing authorized contact-erasure exception, not agreement erasure.
create function komisio_private.preserve_seller_registration() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.name='' and new.email='' and new.phone=''
  and (to_jsonb(new)-array['name','email','phone'])=(to_jsonb(old)-array['name','email','phone'])
  and exists(select 1 from public.seller_registration_reviews r where r.registration_id=old.id
    and komisio_private.seller_erasure_authorized(r.tenant_id,r.seller_id)) then return new; end if;
 raise exception 'IMMUTABLE_AGREEMENT_RECORD' using errcode='55000';
end $$;
create trigger immutable_registration before update or delete on public.seller_registrations
 for each row execute function komisio_private.preserve_seller_registration();
create function komisio_private.erase_registration_contact() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.privacy_closed_at is not null and old.privacy_closed_at is null then
  update public.seller_registrations a set name='',email='',phone=''
   from public.seller_registration_reviews r where r.registration_id=a.id and r.tenant_id=new.tenant_id and r.seller_id=new.id;
 end if;
 return new;
end $$;
create trigger erase_registration_contact after update of privacy_closed_at on public.sellers
 for each row execute function komisio_private.erase_registration_contact();

create function public.seller_registration_settings(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_link public.seller_registration_links;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into current_link from public.seller_registration_links where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_link.id,'enabled',coalesce(current_link.enabled,false),'token',current_link.token,
  'hasAgreement',exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant));
end $$;

create function public.set_seller_registration(p_tenant uuid,p_id uuid,p_expected uuid,p_action text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); current_link public.seller_registration_links; prior public.seller_registration_links; actor_role text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 actor_role:=public.tenant_role(p_tenant);
 if coalesce(actor_role,'') not in ('owner','admin','staff') or (p_action='enable' and actor_role='staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_action is null or p_action not in ('enable','disable','rotate') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_registration_links where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.action<>p_action or prior.previous_id is distinct from p_expected then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.id;
 end if;
 select * into current_link from public.seller_registration_links where tenant_id=p_tenant order by version desc limit 1;
 if current_link.id is distinct from p_expected then raise exception 'REGISTRATION_CHANGED'; end if;
 if p_action='rotate' and not coalesce(current_link.enabled,false) then raise exception 'REGISTRATION_DISABLED'; end if;
 if p_action<>'disable' and not exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant) then raise exception 'AGREEMENT_REQUIRED'; end if;
 insert into public.seller_registration_links(id,tenant_id,version,previous_id,action,enabled,token,created_by)
 values(p_id,p_tenant,coalesce(current_link.version,0)+1,current_link.id,p_action,p_action<>'disable',
  -- Built-ins keep the capability independent of the installation's pgcrypto schema.
  case when p_action<>'disable' then encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex') end,uid);
 perform komisio_private.record_access(p_tenant,'seller_registration.link_changed',p_id,jsonb_build_object('action',p_action));
 return p_id;
end $$;

-- No account matching or agreement is exposed without the normal verified/MFA identity.
create function public.seller_registration_entry(p_token text,p_language text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); link public.seller_registration_links; agreement public.seller_agreement_versions;
 translation public.seller_agreement_translations; application public.seller_registrations; address text; matched uuid; matches integer; base jsonb;
begin
 select l.* into link from public.seller_registration_links l where l.token=p_token and l.enabled
  and not exists(select 1 from public.seller_registration_links newer where newer.tenant_id=l.tenant_id and newer.version>l.version);
 if link.id is null then return jsonb_build_object('state','unavailable'); end if;
 select lower(trim(email)) into address from auth.users where id=uid;
 base:=jsonb_build_object('tenantId',link.tenant_id,'storeName',(select name from public.tenants where id=link.tenant_id),'email',address);
 select count(*),(array_agg(id))[1] into matches,matched from public.sellers where tenant_id=link.tenant_id and lower(trim(email))=address and privacy_closed_at is null;
 if matches=1 then return base||jsonb_build_object('state','existing','sellerId',matched); end if;
 select a.* into application from public.seller_registrations a where a.tenant_id=link.tenant_id and a.user_id=uid
  and not exists(select 1 from public.seller_registration_reviews r where r.registration_id=a.id) order by a.created_at desc limit 1;
 if application.id is not null then return base||jsonb_build_object('state','pending'); end if;
 select * into agreement from public.seller_agreement_versions where tenant_id=link.tenant_id order by version desc limit 1;
 if agreement.id is null then return jsonb_build_object('state','unavailable'); end if;
 select * into translation from public.seller_agreement_translations where tenant_id=link.tenant_id and agreement_id=agreement.id and language=p_language;
 return base||jsonb_build_object('state','form','agreement',jsonb_build_object('id',agreement.id,'version',agreement.version,
  'translationId',translation.id,'title',coalesce(translation.title,agreement.title),'body',coalesce(translation.body,agreement.body),'language',coalesce(translation.language,agreement.language)));
end $$;

create function public.submit_seller_registration(p_token text,p_id uuid,p_name text,p_phone text,p_agreement uuid,p_translation uuid,p_accepted boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); link public.seller_registration_links; prior public.seller_registrations;
 agreement public.seller_agreement_versions; translation public.seller_agreement_translations; address text; matches integer; matched uuid;
begin
 if p_id is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_phone is null or length(trim(p_phone)) not between 1 and 40
  or p_agreement is null or p_accepted is distinct from true then raise exception 'INVALID_INPUT'; end if;
 select * into link from public.seller_registration_links where token=p_token;
 if link.id is null then raise exception 'REGISTRATION_DISABLED'; end if;
 perform 1 from public.tenants where id=link.tenant_id for update;
 select lower(trim(email)) into address from auth.users where id=uid;
 select * into prior from public.seller_registrations where id=p_id;
 if found then
  if prior.tenant_id<>link.tenant_id or prior.link_id<>link.id or prior.user_id<>uid or prior.name<>trim(p_name) or prior.phone<>trim(p_phone)
   or prior.email is distinct from address or prior.agreement_id<>p_agreement or prior.translation_id is distinct from p_translation then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('state','submitted');
 end if;
 if not link.enabled or exists(select 1 from public.seller_registration_links where tenant_id=link.tenant_id and version>link.version) then raise exception 'REGISTRATION_DISABLED'; end if;
 select count(*),(array_agg(id))[1] into matches,matched from public.sellers where tenant_id=link.tenant_id and lower(trim(email))=address and privacy_closed_at is null;
 if matches=1 then return jsonb_build_object('state','existing','sellerId',matched); end if;
 if exists(select 1 from public.seller_registrations a where a.tenant_id=link.tenant_id and a.user_id=uid
  and not exists(select 1 from public.seller_registration_reviews r where r.registration_id=a.id)) then return jsonb_build_object('state','submitted'); end if;
 select * into agreement from public.seller_agreement_versions where tenant_id=link.tenant_id order by version desc limit 1;
 if agreement.id is null or agreement.id<>p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_translation is not null then
  select * into translation from public.seller_agreement_translations where tenant_id=link.tenant_id and agreement_id=p_agreement and id=p_translation;
  if translation.id is null then raise exception 'AGREEMENT_CHANGED'; end if;
 end if;
 insert into public.seller_registrations(id,tenant_id,link_id,user_id,name,email,phone,agreement_id,translation_id,agreement_text)
 values(p_id,link.tenant_id,link.id,uid,trim(p_name),address,trim(p_phone),agreement.id,translation.id,
  jsonb_build_object('version',agreement.version,'title',coalesce(translation.title,agreement.title),'body',coalesce(translation.body,agreement.body),'language',coalesce(translation.language,agreement.language)));
 perform komisio_private.record_access(link.tenant_id,'seller_registration.submitted',p_id,jsonb_build_object('agreementId',agreement.id));
 return jsonb_build_object('state','submitted');
end $$;

create function public.my_seller_registrations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); result jsonb;
begin
 select coalesce(jsonb_agg(row_data order by created_at desc),'[]') into result from (
  select a.created_at,jsonb_build_object('id',a.id,'storeName',t.name,'createdAt',a.created_at,
    'state',case when r.id is null then 'pending' when r.approved then 'approved' else 'rejected' end) row_data
  from public.seller_registrations a join public.tenants t on t.id=a.tenant_id
  left join public.seller_registration_reviews r on r.registration_id=a.id
  where a.user_id=uid order by a.created_at desc limit 100
 ) rows;
 return result;
end $$;

create function public.store_seller_registrations(p_tenant uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total bigint;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'INVALID_INPUT'; end if;
 select count(*) into total from public.seller_registrations a where a.tenant_id=p_tenant and not exists(select 1 from public.seller_registration_reviews r where r.registration_id=a.id);
 select coalesce(jsonb_agg(row_data order by created_at,id),'[]') into result from (
  select a.created_at,a.id,jsonb_build_object('id',a.id,'name',a.name,'email',a.email,'phone',a.phone,'createdAt',a.created_at,'agreement',a.agreement_text,
   'matches',(select count(*) from public.sellers s where s.tenant_id=p_tenant and lower(trim(s.email))=a.email and s.privacy_closed_at is null),
   'emailChanged',not exists(select 1 from auth.users u where u.id=a.user_id and u.email_confirmed_at is not null and lower(trim(u.email))=a.email)) row_data
  from public.seller_registrations a where a.tenant_id=p_tenant and not exists(select 1 from public.seller_registration_reviews r where r.registration_id=a.id)
  order by a.created_at,a.id limit 25 offset p_offset
 ) rows;
 return jsonb_build_object('total',total,'rows',result);
end $$;

create function public.review_seller_registration(p_tenant uuid,p_id uuid,p_registration uuid,p_approved boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); application public.seller_registrations; prior public.seller_registration_reviews;
 matched uuid; matches integer; created boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_registration is null or p_approved is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_registration_reviews where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.registration_id<>p_registration or prior.approved<>p_approved then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.seller_id;
 end if;
 select * into application from public.seller_registrations where tenant_id=p_tenant and id=p_registration;
 if application.id is null then raise exception 'REGISTRATION_NOT_FOUND'; end if;
 if exists(select 1 from public.seller_registration_reviews where registration_id=p_registration) then raise exception 'REGISTRATION_REVIEWED'; end if;
 if p_approved then
  -- Serialize approval with email/account updates as well as all existing seller commands.
  perform 1 from auth.users where id=application.user_id and email_confirmed_at is not null and lower(trim(email))=application.email for share;
  if not found then raise exception 'REGISTRATION_EMAIL_CHANGED'; end if;
  select count(*),(array_agg(id))[1] into matches,matched from public.sellers where tenant_id=p_tenant and lower(trim(email))=application.email and privacy_closed_at is null;
  if matches>1 then raise exception 'REGISTRATION_AMBIGUOUS'; end if;
  if matches=0 then
   matched:=public.register_seller(p_tenant,gen_random_uuid(),application.name,application.email,application.phone);
   created:=true;
  end if;
  -- The original seller action is the evidence; approving staff is recorded separately.
  insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,recorded_at,source,translation_id)
  values(gen_random_uuid(),p_tenant,application.agreement_id,matched,application.email,application.user_id,application.created_at,'seller_portal',application.translation_id);
 end if;
 insert into public.seller_registration_reviews(id,tenant_id,registration_id,approved,seller_id,created_seller,created_by)
 values(p_id,p_tenant,p_registration,p_approved,matched,created,uid);
 perform komisio_private.record_access(p_tenant,'seller_registration.reviewed',p_id,jsonb_build_object('registrationId',p_registration,'approved',p_approved,'createdSeller',created));
 return matched;
end $$;

revoke all on function public.seller_registration_settings(uuid),public.set_seller_registration(uuid,uuid,uuid,text),
 public.seller_registration_entry(text,text),public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean),
 public.my_seller_registrations(),public.store_seller_registrations(uuid,integer),public.review_seller_registration(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.seller_registration_settings(uuid),public.set_seller_registration(uuid,uuid,uuid,text),
 public.seller_registration_entry(text,text),public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean),
 public.my_seller_registrations(),public.store_seller_registrations(uuid,integer),public.review_seller_registration(uuid,uuid,uuid,boolean) to authenticated;
revoke all on function komisio_private.preserve_seller_registration(),komisio_private.erase_registration_contact() from public,anon,authenticated;

create or replace function komisio_private.seller_agreement_usage(p_tenant uuid,p_agreement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sellers bigint; receipts bigint; reviews bigint; items bigint; sales bigint; refs jsonb;
begin
 select count(distinct seller_id) into sellers from public.seller_agreement_evidence
  where tenant_id=p_tenant and agreement_id=p_agreement;
 select count(*) into receipts from public.bag_receipts
  where tenant_id=p_tenant and agreement_version_id=p_agreement;
 select count(*) into reviews from public.reception_reviews
  where tenant_id=p_tenant and agreement_id=p_agreement;
 -- Pending and rejected applications still contain personally accepted terms.
 reviews:=reviews+(select count(*) from public.seller_registrations where tenant_id=p_tenant and agreement_id=p_agreement);
 select count(*) into items from public.items
  where tenant_id=p_tenant and terms->>'agreementVersionId'=p_agreement::text;
 select count(*) into sales from public.sale_lines
  where tenant_id=p_tenant and agreement_version_id=p_agreement;
 refs:=jsonb_build_object('sellers',sellers,'receipts',receipts,'reviews',reviews,'items',items,'sales',sales);
 return (select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(refs) e(k,v) where v<>'0'::jsonb);
end $$;
