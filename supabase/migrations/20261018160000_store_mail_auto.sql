-- #499: agreement-based subscriptions are distinct from a seller's own opt-in.
create table public.store_mail_auto_settings (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 enabled boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.store_mail_auto_settings(tenant_id,id)
);
alter table public.store_mail_auto_settings enable row level security;
revoke all on public.store_mail_auto_settings from public,anon,authenticated;
create trigger immutable_store_mail_setting before update or delete on public.store_mail_auto_settings
 for each row execute function komisio_private.preserve_agreement_record();
alter table public.seller_registrations add column mail_setting_id uuid,
 add foreign key(tenant_id,mail_setting_id) references public.store_mail_auto_settings(tenant_id,id);
alter table public.seller_store_mail_consents drop constraint seller_store_mail_consents_source_check,
 add column agreement_id uuid,
 add column registration_id uuid unique,
 add foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id),
 add foreign key(tenant_id,registration_id) references public.seller_registrations(tenant_id,id),
 add constraint seller_store_mail_consents_source_check check(source in ('seller','unsubscribe','store_auto_subscription')),
 add constraint store_mail_auto_evidence check(
  (source='store_auto_subscription' and enabled and agreement_id is not null and registration_id is not null and actor_id is not null)
  or (source<>'store_auto_subscription' and agreement_id is null and registration_id is null));

create function public.store_mail_auto_settings(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.store_mail_auto_settings;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.store_mail_auto_settings where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',s.id,'enabled',coalesce(s.enabled,false));
end $$;
create function public.set_store_mail_auto(p_tenant uuid,p_id uuid,p_expected uuid,p_enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.store_mail_auto_settings; prior public.store_mail_auto_settings;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_mail_auto_settings where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.previous_id is distinct from p_expected or prior.enabled<>p_enabled then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into s from public.store_mail_auto_settings where tenant_id=p_tenant order by version desc limit 1;
 if s.id is distinct from p_expected then raise exception 'CONSENT_CHANGED'; end if;
 insert into public.store_mail_auto_settings(id,tenant_id,version,previous_id,enabled,created_by)
 values(p_id,p_tenant,coalesce(s.version,0)+1,s.id,p_enabled,uid);
 perform komisio_private.record_access(p_tenant,'store_mail.auto_setting',p_id,jsonb_build_object('enabled',p_enabled));
 return p_id;
end $$;

-- This immutable v1 addendum is displayed inside the agreement and frozen with it.
create function komisio_private.store_mail_notice(p_language text) returns text
language sql immutable set search_path='' as $$
 select case p_language
 when 'sv' then 'När du registrerar dig som säljare i butiken får butiken skicka nyheter och information till dig via mejl. Du kan när som helst avregistrera dig via länken i mejlen eller i säljportalen. Det påverkar inte aviseringar om dina varor och utbetalningar.'
 when 'no' then 'Når du registrerer deg som selger i butikken, kan butikken sende deg nyheter og informasjon på e-post. Du kan når som helst melde deg av via lenken i e-posten eller i selgerportalen. Dette påvirker ikke varsler om varene dine og utbetalinger.'
 when 'dk' then 'Når du registrerer dig som sælger i butikken, må butikken sende dig nyheder og information via e-mail. Du kan til enhver tid afmelde dig via linket i e-mailen eller i sælgerportalen. Det påvirker ikke beskeder om dine varer og udbetalinger.'
 when 'fi' then 'Kun rekisteröidyt myymälän myyjäksi, myymälä saa lähettää sinulle uutisia ja tietoja sähköpostitse. Voit peruuttaa tilauksen milloin tahansa sähköpostin linkistä tai myyjäportaalissa. Tämä ei vaikuta tavaroitasi ja tilityksiäsi koskeviin ilmoituksiin.'
 when 'de' then 'Wenn Sie sich als Verkäufer im Geschäft registrieren, darf das Geschäft Ihnen Neuigkeiten und Informationen per E-Mail senden. Sie können sich jederzeit über den Link in der E-Mail oder im Verkäuferportal abmelden. Benachrichtigungen zu Ihren Artikeln und Auszahlungen bleiben davon unberührt.'
 when 'es' then 'Al registrarte como vendedor en la tienda, la tienda podrá enviarte noticias e información por correo electrónico. Puedes darte de baja en cualquier momento mediante el enlace del correo o en el portal de vendedores. Esto no afecta a las notificaciones sobre tus artículos y pagos.'
 when 'it' then 'Quando ti registri come venditore nel negozio, il negozio può inviarti notizie e informazioni via email. Puoi annullare la ricezione in qualsiasi momento tramite il link nelle email o nel portale venditori. Questo non influisce sulle notifiche relative ai tuoi articoli e pagamenti.'
 else 'When you register as a seller with the store, the store may send you news and information by email. You can unsubscribe at any time using the link in the email or in the seller portal. This does not affect notifications about your items and payouts.' end;
$$;
create or replace function public.seller_registration_entry(p_token text,p_language text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); link public.seller_registration_links; agreement public.seller_agreement_versions;
 translation public.seller_agreement_translations; application public.seller_registrations; address text; matched uuid; matches integer; base jsonb; mail_setting uuid;
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
 select id into mail_setting from public.store_mail_auto_settings where tenant_id=link.tenant_id and enabled
  and version=(select max(version) from public.store_mail_auto_settings where tenant_id=link.tenant_id);
 return base||jsonb_build_object('mailSettingId',mail_setting,'state','form','agreement',jsonb_build_object('id',agreement.id,'version',agreement.version,
  'translationId',translation.id,'title',coalesce(translation.title,agreement.title),'body',coalesce(translation.body,agreement.body)||case when mail_setting is not null then E'\n\n'||komisio_private.store_mail_notice(coalesce(translation.language,agreement.language)) else '' end,'language',coalesce(translation.language,agreement.language)));
end $$;
drop function public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean);
create or replace function public.submit_seller_registration(p_token text,p_id uuid,p_name text,p_phone text,p_agreement uuid,p_translation uuid,p_accepted boolean,p_mail_setting uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); link public.seller_registration_links; prior public.seller_registrations;
 agreement public.seller_agreement_versions; translation public.seller_agreement_translations; address text; matches integer; matched uuid; mail_setting uuid;
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
   or prior.mail_setting_id is distinct from p_mail_setting or prior.email is distinct from address or prior.agreement_id<>p_agreement or prior.translation_id is distinct from p_translation then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('state','submitted');
 end if;
 if not link.enabled or exists(select 1 from public.seller_registration_links where tenant_id=link.tenant_id and version>link.version) then raise exception 'REGISTRATION_DISABLED'; end if;
 select count(*),(array_agg(id))[1] into matches,matched from public.sellers where tenant_id=link.tenant_id and lower(trim(email))=address and privacy_closed_at is null;
 if matches=1 then return jsonb_build_object('state','existing','sellerId',matched); end if;
 if exists(select 1 from public.seller_registrations a where a.tenant_id=link.tenant_id and a.user_id=uid
  and not exists(select 1 from public.seller_registration_reviews r where r.registration_id=a.id)) then return jsonb_build_object('state','submitted'); end if;
 select id into mail_setting from public.store_mail_auto_settings where tenant_id=link.tenant_id and enabled
  and version=(select max(version) from public.store_mail_auto_settings where tenant_id=link.tenant_id);
 if mail_setting is distinct from p_mail_setting then raise exception 'AGREEMENT_CHANGED'; end if;
 select * into agreement from public.seller_agreement_versions where tenant_id=link.tenant_id order by version desc limit 1;
 if agreement.id is null or agreement.id<>p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_translation is not null then
  select * into translation from public.seller_agreement_translations where tenant_id=link.tenant_id and agreement_id=p_agreement and id=p_translation;
  if translation.id is null then raise exception 'AGREEMENT_CHANGED'; end if;
 end if;
 insert into public.seller_registrations(id,tenant_id,link_id,user_id,name,email,phone,agreement_id,translation_id,mail_setting_id,agreement_text)
 values(p_id,link.tenant_id,link.id,uid,trim(p_name),address,trim(p_phone),agreement.id,translation.id,mail_setting,
  jsonb_build_object('version',agreement.version,'title',coalesce(translation.title,agreement.title),'body',coalesce(translation.body,agreement.body)||case when mail_setting is not null then E'\n\n'||komisio_private.store_mail_notice(coalesce(translation.language,agreement.language)) else '' end,'language',coalesce(translation.language,agreement.language)));
 perform komisio_private.record_access(link.tenant_id,'seller_registration.submitted',p_id,jsonb_build_object('agreementId',agreement.id));
 return jsonb_build_object('state','submitted');
end $$;
create or replace function public.review_seller_registration(p_tenant uuid,p_id uuid,p_registration uuid,p_approved boolean) returns uuid
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
 -- Only a newly created self-registered seller, accepted during the current enabled
 -- setting revision, is eligible. Off/on never retroactively enrolls old applications.
 if created and application.mail_setting_id is not null and exists(
  select 1 from public.store_mail_auto_settings s where s.id=application.mail_setting_id and s.tenant_id=p_tenant and s.enabled
   and s.version=(select max(version) from public.store_mail_auto_settings where tenant_id=p_tenant)
 ) and not exists(select 1 from public.seller_store_mail_consents where tenant_id=p_tenant and seller_id=matched) then
  insert into public.seller_store_mail_consents(id,tenant_id,seller_id,enabled,email_hash,source,actor_id,agreement_id,registration_id)
  values(gen_random_uuid(),p_tenant,matched,true,encode(sha256(convert_to(application.email,'UTF8')),'hex'),
   'store_auto_subscription',application.user_id,application.agreement_id,application.id);
 end if;
 perform komisio_private.record_access(p_tenant,'seller_registration.reviewed',p_id,jsonb_build_object('registrationId',p_registration,'approved',p_approved,'createdSeller',created));
 return matched;
end $$;

create function komisio_private.store_seller_mail_state(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.seller_store_mail_consents; address text; active boolean;
begin
 select lower(trim(email)) into address from public.sellers where tenant_id=p_tenant and id=p_seller and privacy_closed_at is null;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into c from public.seller_store_mail_consents where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1;
 active:=coalesce(c.enabled and c.email_hash=encode(sha256(convert_to(address,'UTF8')),'hex') and address<>'',false);
 return jsonb_build_object('id',c.id,'enabled',active,'source',c.source,'date',c.created_at,'agreementId',c.agreement_id,
  'status',case when coalesce(address,'')='' then 'noEmail' when active and c.source='store_auto_subscription' then 'automatic'
   when active then 'own' when c.enabled=false then 'unsubscribed' else 'none' end);
end $$;
create or replace function public.my_store_mail_consent(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform komisio_private.require_seller(p_tenant,p_seller);
 return komisio_private.store_seller_mail_state(p_tenant,p_seller);
end $$;
create function public.store_seller_mail_status(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return komisio_private.store_seller_mail_state(p_tenant,p_seller);
end $$;
create or replace function komisio_private.store_mail_audience(p_tenant uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('seller',s.id,'consent',c.id,'source',c.source) order by s.id),'[]'::jsonb)
 from public.sellers s cross join lateral(select * from public.seller_store_mail_consents c where c.tenant_id=s.tenant_id and c.seller_id=s.id order by seq desc limit 1)c
 where s.tenant_id=p_tenant and s.privacy_closed_at is null and trim(s.email)<>'' and c.enabled
 and c.email_hash=encode(sha256(convert_to(lower(trim(s.email)),'UTF8')),'hex');
$$;
create or replace function public.preview_store_mail(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare audience jsonb; missing integer; total integer; profile jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 audience:=komisio_private.store_mail_audience(p_tenant);
 select count(*),count(*) filter(where trim(email)='') into total,missing from public.sellers where tenant_id=p_tenant and privacy_closed_at is null;
 profile:=public.current_store_profile(p_tenant)->'profile';
 return jsonb_build_object('own', (select count(*) from jsonb_array_elements(audience) e where e->>'source'='seller'), 'automatic',(select count(*) from jsonb_array_elements(audience) e where e->>'source'='store_auto_subscription'), 'eligible',jsonb_array_length(audience),'missingEmail',missing,'withoutConsent',total-missing-jsonb_array_length(audience),
 'revision',encode(sha256(convert_to(audience::text,'UTF8')),'hex'),'replyTo',coalesce(profile->'contact'->>'email',''),
 'senderName',(select name from public.tenants where id=p_tenant));
end $$;
create or replace function public.store_mail_history(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
  select s.created_at,jsonb_build_object('id',s.id,'subject',s.subject,'body',s.body,'senderName',s.sender_name,'replyTo',s.reply_to,'createdAt',s.created_at,'createdBy',coalesce((select nullif(display_name,'') from public.user_profiles where user_id=s.created_by),(select email from auth.users where id=s.created_by),s.created_by::text),
  'own',(select count(*) from jsonb_array_elements(s.audience) e join public.seller_store_mail_consents c on c.id=(e->>'consent')::uuid where c.source='seller'), 'automatic',(select count(*) from jsonb_array_elements(s.audience) e join public.seller_store_mail_consents c on c.id=(e->>'consent')::uuid where c.source='store_auto_subscription'), 'total',jsonb_array_length(s.audience),'missingEmail',s.missing_email,'withoutConsent',s.without_consent,'skipped',cardinality(s.skipped),
  'remaining',jsonb_array_length(s.audience)-cardinality(s.skipped)-(select count(*) from public.seller_communications c where c.store_mail_id=s.id),
  'outcomes',coalesce((select jsonb_object_agg(status,n) from (select case when status='queued' then 'unconfirmed' else status end status,count(*) n from public.seller_communications c where c.store_mail_id=s.id group by case when status='queued' then 'unconfirmed' else status end)y),'{}'::jsonb)) payload
  from public.store_mail_sends s where s.tenant_id=p_tenant order by s.created_at desc limit 50
 )x),'[]'::jsonb);
end $$;

revoke all on function public.store_mail_auto_settings(uuid),public.set_store_mail_auto(uuid,uuid,uuid,boolean),
 public.store_seller_mail_status(uuid,uuid),public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.store_mail_auto_settings(uuid),public.set_store_mail_auto(uuid,uuid,uuid,boolean),
 public.store_seller_mail_status(uuid,uuid),public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean,uuid) to authenticated;
revoke all on function komisio_private.store_seller_mail_state(uuid,uuid),komisio_private.store_mail_notice(text) from public,anon,authenticated;
