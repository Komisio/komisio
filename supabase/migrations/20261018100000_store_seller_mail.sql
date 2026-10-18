-- #477: explicit store consent, frozen audience and at-most-once dispatch claims.
create table public.seller_store_mail_consents (
 id uuid primary key,
 seq bigint generated always as identity unique,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 previous_id uuid references public.seller_store_mail_consents(id),
 enabled boolean not null,
 email_hash text not null check(length(email_hash)=64),
 source text not null check(source in ('seller','unsubscribe')),
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
create index seller_store_mail_current on public.seller_store_mail_consents(tenant_id,seller_id,seq desc);
alter table public.seller_store_mail_consents enable row level security;
revoke all on public.seller_store_mail_consents from public,anon,authenticated;

create table public.store_mail_sends (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 subject text not null check(length(subject) between 1 and 200),
 body text not null check(length(body) between 1 and 7000),
 sender_name text not null,
 reply_to text not null,
 locale text not null check(locale in ('sv','en','no','dk','fi','de','es','it')),
 audience jsonb not null check(jsonb_typeof(audience)='array'),
 revision text not null,
 missing_email integer not null,
 without_consent integer not null,
 skipped uuid[] not null default '{}',
 next_dispatch_at timestamptz,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create index store_mail_tenant_history on public.store_mail_sends(tenant_id,created_at desc);
create index store_mail_dispatch_clock on public.store_mail_sends(next_dispatch_at desc) where next_dispatch_at is not null;
alter table public.store_mail_sends enable row level security;
revoke all on public.store_mail_sends from public,anon,authenticated;
alter table public.seller_communications
 add column store_mail_id uuid,
 add column unsubscribe_hash text check(unsubscribe_hash is null or length(unsubscribe_hash)=64),
 add foreign key(tenant_id,store_mail_id) references public.store_mail_sends(tenant_id,id);
create unique index store_mail_recipient_once on public.seller_communications(store_mail_id,seller_id) where store_mail_id is not null;

create function komisio_private.guard_store_mail() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='seller_store_mail_consents' or tg_op='DELETE' then raise exception 'IMMUTABLE_STORE_MAIL'; end if;
 if (to_jsonb(new)-'skipped'-'next_dispatch_at') is distinct from (to_jsonb(old)-'skipped'-'next_dispatch_at') then raise exception 'IMMUTABLE_STORE_MAIL'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_store_mail() from public,anon,authenticated;
create trigger store_mail_immutable before update or delete on public.store_mail_sends for each row execute function komisio_private.guard_store_mail();
create trigger store_mail_consent_immutable before update or delete on public.seller_store_mail_consents for each row execute function komisio_private.guard_store_mail();

create function public.my_store_mail_consent(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.seller_store_mail_consents; address text;
begin
 perform komisio_private.require_identity();
 perform komisio_private.require_seller(p_tenant,p_seller);
 select lower(trim(email)) into address from public.sellers where tenant_id=p_tenant and id=p_seller and privacy_closed_at is null;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into c from public.seller_store_mail_consents where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1;
 return jsonb_build_object('id',c.id,'enabled',coalesce(c.enabled and c.email_hash=encode(sha256(convert_to(address,'UTF8')),'hex'),false));
end $$;

create function public.set_store_mail_consent(p_tenant uuid,p_seller uuid,p_id uuid,p_expected uuid,p_enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; current_id uuid; address text; prior public.seller_store_mail_consents;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
 select lower(trim(email)) into address from public.sellers where tenant_id=p_tenant and id=p_seller and privacy_closed_at is null;
 if not found or address='' then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.seller_store_mail_consents where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.actor_id is distinct from uid or prior.previous_id is distinct from p_expected or prior.enabled<>p_enabled or prior.source<>'seller' then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select id into current_id from public.seller_store_mail_consents where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1;
 if current_id is distinct from p_expected then raise exception 'CONSENT_CHANGED'; end if;
 insert into public.seller_store_mail_consents(id,tenant_id,seller_id,previous_id,enabled,email_hash,source,actor_id)
 values(p_id,p_tenant,p_seller,p_expected,p_enabled,encode(sha256(convert_to(address,'UTF8')),'hex'),'seller',uid);
 perform komisio_private.record_access(p_tenant,'seller.store_mail_consent',p_seller,jsonb_build_object('enabled',p_enabled,'version',p_id));
 return p_id;
end $$;

create function komisio_private.store_mail_audience(p_tenant uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('seller',s.id,'consent',c.id) order by s.id),'[]'::jsonb)
 from public.sellers s cross join lateral(select * from public.seller_store_mail_consents c where c.tenant_id=s.tenant_id and c.seller_id=s.id order by seq desc limit 1)c
 where s.tenant_id=p_tenant and s.privacy_closed_at is null and trim(s.email)<>'' and c.enabled
 and c.email_hash=encode(sha256(convert_to(lower(trim(s.email)),'UTF8')),'hex');
$$;
revoke all on function komisio_private.store_mail_audience(uuid) from public,anon,authenticated;

create function public.preview_store_mail(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare audience jsonb; missing integer; total integer; profile jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 audience:=komisio_private.store_mail_audience(p_tenant);
 select count(*),count(*) filter(where trim(email)='') into total,missing from public.sellers where tenant_id=p_tenant and privacy_closed_at is null;
 profile:=public.current_store_profile(p_tenant)->'profile';
 return jsonb_build_object('eligible',jsonb_array_length(audience),'missingEmail',missing,'withoutConsent',total-missing-jsonb_array_length(audience),
 'revision',encode(sha256(convert_to(audience::text,'UTF8')),'hex'),'replyTo',coalesce(profile->'contact'->>'email',''),
 'senderName',(select name from public.tenants where id=p_tenant));
end $$;

create function public.create_store_mail(p_tenant uuid,p_id uuid,p_subject text,p_body text,p_revision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.store_mail_sends; preview jsonb; profile jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_subject ~ '[\r\n]' or p_body is null or length(trim(p_body)) not between 1 and 7000 or p_revision is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_mail_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.subject<>trim(p_subject) or prior.body<>trim(p_body) or prior.revision<>p_revision then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 preview:=public.preview_store_mail(p_tenant);
 if preview->>'revision'<>p_revision then raise exception 'AUDIENCE_CHANGED'; end if;
 if preview->>'replyTo' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'STORE_EMAIL_MISSING'; end if;
 if (preview->>'eligible')::int=0 then raise exception 'NO_RECIPIENTS'; end if;
 profile:=public.current_store_profile(p_tenant)->'profile';
 insert into public.store_mail_sends(id,tenant_id,subject,body,sender_name,reply_to,locale,audience,revision,missing_email,without_consent,created_by)
 values(p_id,p_tenant,trim(p_subject),trim(p_body),preview->>'senderName',preview->>'replyTo',coalesce(profile->>'language','en'),komisio_private.store_mail_audience(p_tenant),p_revision,(preview->>'missingEmail')::int,(preview->>'withoutConsent')::int,uid);
 perform komisio_private.record_access(p_tenant,'store_mail.confirmed',p_id,jsonb_build_object('recipients',preview->'eligible'));
 return p_id;
end $$;

-- One global reservation per second, shared across stores and tabs. A committed
-- communication is an irreversible claim: crashes/timeouts never resend it.
create function public.claim_store_mail(p_tenant uuid,p_send uuid,p_message uuid,p_unsubscribe_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaign public.store_mail_sends; entry jsonb; c public.seller_store_mail_consents; address text; next_time timestamptz;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_message is null or p_unsubscribe_hash is null or p_unsubscribe_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.seller_communications where id=p_message) then raise exception 'REQUEST_CONFLICT'; end if;
 select * into campaign from public.store_mail_sends where tenant_id=p_tenant and id=p_send;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(477,1);
 select max(next_dispatch_at) into next_time from public.store_mail_sends;
 if next_time>clock_timestamp() then return jsonb_build_object('waitMs',ceil(extract(epoch from next_time-clock_timestamp())*1000)); end if;
 for entry in select value from jsonb_array_elements(campaign.audience) loop
  if (entry->>'seller')::uuid=any(campaign.skipped) or exists(select 1 from public.seller_communications where store_mail_id=p_send and seller_id=(entry->>'seller')::uuid) then continue; end if;
  select * into c from public.seller_store_mail_consents where tenant_id=p_tenant and seller_id=(entry->>'seller')::uuid order by seq desc limit 1;
  select lower(trim(email)) into address from public.sellers where tenant_id=p_tenant and id=(entry->>'seller')::uuid and privacy_closed_at is null;
  if address is null or address='' or not c.enabled or c.id is distinct from (entry->>'consent')::uuid or c.email_hash<>encode(sha256(convert_to(address,'UTF8')),'hex') then
   update public.store_mail_sends set skipped=array_append(skipped,(entry->>'seller')::uuid) where id=p_send;
   continue;
  end if;
  perform public.queue_seller_communication(p_tenant,p_message,c.seller_id,'message','store_bulk','1',campaign.locale,campaign.subject,campaign.body,'none',null);
  perform set_config('komisio.communication_delivery','engine',true);
  update public.seller_communications set store_mail_id=p_send,unsubscribe_hash=p_unsubscribe_hash where id=p_message;
  perform set_config('komisio.communication_delivery','',true);
  update public.store_mail_sends set next_dispatch_at=clock_timestamp()+interval '1 second' where id=p_send;
  return jsonb_build_object('messageId',p_message,'to',address,'subject',campaign.subject,'body',campaign.body,'senderName',campaign.sender_name,'replyTo',campaign.reply_to,'locale',campaign.locale);
 end loop;
 return jsonb_build_object('done',true);
end $$;

-- Provider Retry-After is respected for the whole bulk dispatcher. The failed
-- recipient remains in the log; subsequent recipients can resume afterwards.
create function public.defer_store_mail(p_tenant uuid,p_send uuid,p_seconds integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_seconds is null or p_seconds not between 1 and 86400 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(477,1);
 update public.store_mail_sends set next_dispatch_at=greatest(next_dispatch_at,clock_timestamp()+make_interval(secs=>p_seconds)) where tenant_id=p_tenant and id=p_send;
end $$;

create function public.store_mail_history(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
  select s.created_at,jsonb_build_object('id',s.id,'subject',s.subject,'body',s.body,'senderName',s.sender_name,'replyTo',s.reply_to,'createdAt',s.created_at,'createdBy',coalesce((select nullif(display_name,'') from public.user_profiles where user_id=s.created_by),(select email from auth.users where id=s.created_by),s.created_by::text),
  'total',jsonb_array_length(s.audience),'missingEmail',s.missing_email,'withoutConsent',s.without_consent,'skipped',cardinality(s.skipped),
  'remaining',jsonb_array_length(s.audience)-cardinality(s.skipped)-(select count(*) from public.seller_communications c where c.store_mail_id=s.id),
  'outcomes',coalesce((select jsonb_object_agg(status,n) from (select case when status='queued' then 'unconfirmed' else status end status,count(*) n from public.seller_communications c where c.store_mail_id=s.id group by case when status='queued' then 'unconfirmed' else status end)y),'{}'::jsonb)) payload
  from public.store_mail_sends s where s.tenant_id=p_tenant order by s.created_at desc limit 50
 )x),'[]'::jsonb);
end $$;

create function public.unsubscribe_store_mail(p_message uuid,p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
declare m public.seller_communications; c public.seller_store_mail_consents;
begin
 if p_message is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
 select * into m from public.seller_communications where id=p_message and store_mail_id is not null and unsubscribe_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found then return false; end if;
 perform 1 from public.tenants where id=m.tenant_id for update;
 -- Erased sellers have no usable contact and must not regain consent.
 if not exists(select 1 from public.sellers where id=m.seller_id and tenant_id=m.tenant_id and privacy_closed_at is null) then return true; end if;
 select * into c from public.seller_store_mail_consents where tenant_id=m.tenant_id and seller_id=m.seller_id order by seq desc limit 1;
 if c.enabled then
  insert into public.seller_store_mail_consents(id,tenant_id,seller_id,previous_id,enabled,email_hash,source)
  values(gen_random_uuid(),m.tenant_id,m.seller_id,c.id,false,c.email_hash,'unsubscribe');
 end if;
 return true;
end $$;

revoke all on function public.my_store_mail_consent(uuid,uuid),public.set_store_mail_consent(uuid,uuid,uuid,uuid,boolean),public.preview_store_mail(uuid),public.create_store_mail(uuid,uuid,text,text,text),public.claim_store_mail(uuid,uuid,uuid,text),public.defer_store_mail(uuid,uuid,integer),public.store_mail_history(uuid),public.unsubscribe_store_mail(uuid,text) from public,anon,authenticated;
grant execute on function public.my_store_mail_consent(uuid,uuid),public.set_store_mail_consent(uuid,uuid,uuid,uuid,boolean),public.preview_store_mail(uuid),public.create_store_mail(uuid,uuid,text,text,text),public.claim_store_mail(uuid,uuid,uuid,text),public.defer_store_mail(uuid,uuid,integer),public.store_mail_history(uuid) to authenticated;
grant execute on function public.unsubscribe_store_mail(uuid,text) to anon,authenticated;
