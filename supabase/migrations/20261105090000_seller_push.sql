-- #767: independent seller push consent, durable committed facts and one send claim.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_seller_push(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_seller_push(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_store_policy_before_seller_push(value-'pushItemRegistered'-'pushItemSold')
  and (not(value ? 'pushItemRegistered') or jsonb_typeof(value->'pushItemRegistered')='boolean')
  and (not(value ? 'pushItemSold') or jsonb_typeof(value->'pushItemSold')='boolean'),false)
$$;

create table komisio_private.seller_push_devices (
 id uuid primary key, secret_hash text not null, user_id uuid not null references auth.users(id),
 session_id uuid not null, token text, platform text not null check(platform in ('ios','android')),
 locale text not null check(locale in ('sv','en','no','dk','fi','de','es','it')),
 enabled boolean not null, generation uuid not null default gen_random_uuid(),
 revision integer not null default 1 check(revision>0), request_id uuid not null, request_hash text not null,
 enabled_since timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(not enabled or token is not null)
);
create unique index seller_push_device_token on komisio_private.seller_push_devices(token) where enabled;
create index seller_push_device_user on komisio_private.seller_push_devices(user_id) where enabled;
create table komisio_private.seller_push_deliveries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null, item_id uuid not null, device_id uuid not null references komisio_private.seller_push_devices(id),
 device_generation uuid not null, policy_version integer not null,
 kind text not null check(kind in ('item_registered','item_sold')), reference_id uuid not null,
 state text not null default 'queued' check(state in ('queued','claimed','accepted','sent','failed','unconfirmed','cancelled')),
 created_at timestamptz not null default clock_timestamp(), claimed_at timestamptz,
 ticket_id text, receipt_due_at timestamptz, finished_at timestamptz, error_code text not null default '', token_hash text,
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,item_id) references public.items(tenant_id,id),
 unique(device_id,device_generation,kind,reference_id)
);
create index seller_push_pending on komisio_private.seller_push_deliveries(created_at,id) where state='queued';
create index seller_push_receipts on komisio_private.seller_push_deliveries(receipt_due_at,id) where state='accepted';
alter table komisio_private.seller_push_devices enable row level security;
alter table komisio_private.seller_push_deliveries enable row level security;
revoke all on komisio_private.seller_push_devices,komisio_private.seller_push_deliveries from public,anon,authenticated;
alter table public.seller_communications drop constraint seller_communications_channel_check;
alter table public.seller_communications add constraint seller_communications_channel_check check(channel in ('email','push'));

create function komisio_private.require_push_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if exists(select 1 from auth.users where id=uid and raw_app_meta_data->>'komisio_password_recovery_pending'='true')
 then raise exception 'PASSWORD_UPDATE_REQUIRED' using errcode='42501'; end if;
 return uid;
end $$;
create function komisio_private.push_session_valid(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
  and u.email_confirmed_at is not null and u.deleted_at is null
  and coalesce(u.raw_app_meta_data->>'komisio_password_recovery_pending','false')<>'true'
  and (not exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified') or s.aal='aal2'))
$$;
create function komisio_private.require_push_worker() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_user();
begin
 if not exists(select 1 from auth.users where id=uid and raw_app_meta_data->'komisio_push_worker'='true'::jsonb)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return uid;
end $$;

-- Existing staff email completion must not forge a push-provider outcome.
-- Preserve the prior delivery and authorized privacy-redaction guards.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.guard_communication()'::regprocedure);
 definition:=regexp_replace(definition,'\mBEGIN\M',$guard$begin
 if tg_op='UPDATE' and (old.channel='push' or new.channel='push') then
  perform komisio_private.require_push_worker();
  if (to_jsonb(new)-array['status','provider_message_id','delivered_at'])<>(to_jsonb(old)-array['status','provider_message_id','delivered_at'])
  then raise exception 'IMMUTABLE_COMMUNICATION' using errcode='55000'; end if;
 end if;
 $guard$,'i');
 execute definition;
end $$;

create function public.my_push_device(p_device uuid,p_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_user(); d komisio_private.seller_push_devices;
begin
 if p_device is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
 select * into d from komisio_private.seller_push_devices where id=p_device;
 if not found then return jsonb_build_object('revision',0,'enabled',false,'requestId',null); end if;
 if d.secret_hash<>encode(sha256(convert_to(p_secret,'UTF8')),'hex') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('revision',d.revision,'enabled',d.enabled and d.user_id=uid and komisio_private.push_session_valid(d.user_id,d.session_id),
  'requestId',case when d.user_id=uid then d.request_id else null end);
end $$;

create function public.set_my_push_device(p_device uuid,p_secret text,p_id uuid,p_revision integer,p_token text,p_platform text,p_locale text,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_user(); sid uuid; d komisio_private.seller_push_devices;
 fingerprint text; secret_digest text; changed boolean;
begin
 if p_device is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_id is null or p_revision is null or p_revision<0
  or p_enabled is null or p_platform is null or p_platform not in ('ios','android')
  or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
  or (p_enabled and (p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'))
  or (not p_enabled and p_token is not null) then raise exception 'INVALID_INPUT'; end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then raise exception 'AUTH_REQUIRED' using errcode='42501'; end;
 if not komisio_private.push_session_valid(uid,sid) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_enabled and not exists(select 1 from public.sellers s join auth.users u on u.id=uid
  where s.privacy_closed_at is null and s.email<>'' and lower(trim(s.email))=lower(trim(u.email))
  and (select count(*) from public.sellers x where x.tenant_id=s.tenant_id and lower(trim(x.email))=lower(trim(u.email)))=1)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Registration is infrequent; serialize token reassignment and installation revisions.
 lock table komisio_private.seller_push_devices in share row exclusive mode;
 secret_digest:=encode(sha256(convert_to(p_secret,'UTF8')),'hex');
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(uid,sid,p_revision,p_token,p_platform,p_locale,p_enabled)::text,'UTF8')),'hex');
 select * into d from komisio_private.seller_push_devices where id=p_device for update;
 if found then
  if d.secret_hash<>secret_digest then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if d.request_id=p_id then
   if d.request_hash<>fingerprint then raise exception 'REQUEST_CONFLICT'; end if;
   if d.revision<>p_revision+1 or d.enabled is distinct from p_enabled then raise exception 'PUSH_DEVICE_CHANGED'; end if;
   return jsonb_build_object('id',p_id,'deviceId',p_device,'revision',d.revision,'enabled',d.enabled);
  end if;
  if d.revision<>p_revision then raise exception 'PUSH_DEVICE_CHANGED'; end if;
  -- Possession of the installation secret allows the current verified user to
  -- revoke an older account on this phone, without exposing that account/token.
 elsif p_revision<>0 then raise exception 'PUSH_DEVICE_CHANGED'; end if;
 if d.id is null and (select count(*) from komisio_private.seller_push_devices where user_id=uid)>=20
 then raise exception 'PUSH_DEVICE_LIMIT'; end if;
 if p_enabled and exists(select 1 from komisio_private.seller_push_devices x where x.token=p_token and x.enabled and x.id<>p_device and x.user_id<>uid
  and komisio_private.push_session_valid(x.user_id,x.session_id)) then raise exception 'PUSH_DEVICE_IN_USE'; end if;
 if p_enabled then
  update komisio_private.seller_push_devices set enabled=false,token=null,generation=gen_random_uuid(),revision=revision+1,updated_at=clock_timestamp()
  where token=p_token and enabled and id<>p_device;
 end if;
 changed:=d.id is null or d.enabled is distinct from p_enabled or d.user_id is distinct from uid or d.session_id is distinct from sid or d.token is distinct from p_token;
 insert into komisio_private.seller_push_devices(id,secret_hash,user_id,session_id,token,platform,locale,enabled,request_id,request_hash)
 values(p_device,secret_digest,uid,sid,p_token,p_platform,p_locale,p_enabled,p_id,fingerprint)
 on conflict(id) do update set user_id=uid,session_id=sid,token=p_token,platform=p_platform,locale=p_locale,enabled=p_enabled,
  revision=seller_push_devices.revision+1,request_id=p_id,request_hash=fingerprint,updated_at=clock_timestamp(),
  generation=case when changed then gen_random_uuid() else seller_push_devices.generation end,
  enabled_since=case when changed then clock_timestamp() else seller_push_devices.enabled_since end
 returning * into d;
 return jsonb_build_object('id',p_id,'deviceId',p_device,'revision',d.revision,'enabled',d.enabled);
end $$;

create function komisio_private.enqueue_seller_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.items; pol public.store_policy_versions; event_kind text; event_id uuid; event_at timestamptz;
begin
 if tg_table_name='items' then
  i:=new; event_kind:='item_registered'; event_id:=i.id; event_at:=i.accepted_at;
 else
  select * into i from public.items where tenant_id=new.tenant_id and id=new.item_id;
  select recorded_at into event_at from public.sales where tenant_id=new.tenant_id and id=new.sale_id and status='completed';
  if event_at is null or exists(select 1 from public.sale_returns where tenant_id=new.tenant_id and sale_line_id=new.id) then return new; end if;
  event_kind:='item_sold'; event_id:=new.id;
 end if;
 if i.ownership<>'consignment' or i.seller_id is null then return new; end if;
 select * into pol from public.store_policy_versions where tenant_id=i.tenant_id order by version desc limit 1;
 if pol.policy->>(case when event_kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end) is distinct from 'true' then return new; end if;
 insert into komisio_private.seller_push_deliveries(tenant_id,seller_id,item_id,device_id,device_generation,policy_version,kind,reference_id)
 select i.tenant_id,i.seller_id,i.id,d.id,d.generation,pol.version,event_kind,event_id
 from public.sellers s join auth.users u on lower(trim(u.email))=lower(trim(s.email))
 join komisio_private.seller_push_devices d on d.user_id=u.id
 where s.tenant_id=i.tenant_id and s.id=i.seller_id and s.privacy_closed_at is null and s.email<>''
  and (select count(*) from public.sellers x where x.tenant_id=s.tenant_id and lower(trim(x.email))=lower(trim(s.email)))=1
  and d.enabled and komisio_private.push_session_valid(d.user_id,d.session_id)
 on conflict(device_id,device_generation,kind,reference_id) do nothing;
 return new;
end $$;
-- Deferred queue writes commit or roll back with the originating engine fact;
-- network delivery never takes place in a business transaction.
create constraint trigger seller_push_registered after insert on public.items deferrable initially deferred
 for each row execute function komisio_private.enqueue_seller_push();
create constraint trigger seller_push_sold after insert on public.sale_lines deferrable initially deferred
 for each row execute function komisio_private.enqueue_seller_push();

create function komisio_private.seller_push_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from komisio_private.seller_push_deliveries q
  join komisio_private.seller_push_devices d on d.id=q.device_id and d.generation=q.device_generation
  join auth.users u on u.id=d.user_id
  join public.sellers s on s.tenant_id=q.tenant_id and s.id=q.seller_id
  join lateral (select * from public.store_policy_versions where tenant_id=q.tenant_id order by version desc limit 1) p on true
  where q.id=p_id and d.enabled and komisio_private.push_session_valid(d.user_id,d.session_id)
  and s.privacy_closed_at is null and s.email<>'' and lower(trim(s.email))=lower(trim(u.email))
  and (select count(*) from public.sellers x where x.tenant_id=s.tenant_id and lower(trim(x.email))=lower(trim(s.email)))=1
  and p.policy->>(case when q.kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end)='true'
  and not exists(select 1 from public.store_policy_versions disabled where disabled.tenant_id=q.tenant_id and disabled.version>q.policy_version
   and disabled.policy->>(case when q.kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end) is distinct from 'true')
  and (q.kind='item_registered' or exists(select 1 from public.sale_lines l join public.sales sale on sale.tenant_id=l.tenant_id and sale.id=l.sale_id
   where l.tenant_id=q.tenant_id and l.id=q.reference_id and l.item_id=q.item_id and sale.status='completed'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id))))
$$;

create function public.seller_push_candidates() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]') into result from (
  select q.id,q.tenant_id as "tenantId",q.seller_id as "sellerId",q.item_id as "itemId",q.kind,q.created_at as "createdAt",
   d.locale,left(t.name,120) as "storeName",left(coalesce(nullif(komisio_private.item_title(q.tenant_id,q.item_id)->>'title',''),'Komisio'),120) as "itemLabel"
  from komisio_private.seller_push_deliveries q join komisio_private.seller_push_devices d on d.id=q.device_id
  join public.tenants t on t.id=q.tenant_id where q.state='queued' order by q.created_at,q.id limit 50
 ) x;
 return result;
end $$;

create function public.claim_seller_push(p_id uuid,p_locale text,p_subject text,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_worker(); q komisio_private.seller_push_deliveries; d komisio_private.seller_push_devices;
 tenant uuid;
begin
 if p_id is null or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
  or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 1000
 then raise exception 'INVALID_INPUT'; end if;
 select tenant_id into tenant from komisio_private.seller_push_deliveries where id=p_id;
 if tenant is null then return null; end if;
 perform 1 from public.tenants where id=tenant for update;
 select * into q from komisio_private.seller_push_deliveries where id=p_id for update;
 if q.state<>'queued' then return null; end if;
 select * into d from komisio_private.seller_push_devices where id=q.device_id for update;
 if not komisio_private.seller_push_eligible(p_id) then
  update komisio_private.seller_push_deliveries set state='cancelled',finished_at=clock_timestamp() where id=p_id;
  return null;
 end if;
 if d.locale<>p_locale then return null; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,channel,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by)
 values(p_id,q.tenant_id,q.seller_id,case when q.kind='item_registered' then 'item_accepted' else 'item_sold' end,'push','seller.push.'||q.kind,'v1',p_locale,'mobile-device',trim(p_subject),trim(p_body),
  case when q.kind='item_registered' then 'item' else 'sale_line' end,q.reference_id,uid);
 update komisio_private.seller_push_deliveries set state='claimed',claimed_at=clock_timestamp(),token_hash=encode(sha256(convert_to(d.token,'UTF8')),'hex') where id=p_id;
 perform komisio_private.record_access(q.tenant_id,'communication.push_claimed',p_id,jsonb_build_object('seller_id',q.seller_id,'kind',q.kind));
 return jsonb_build_object('id',p_id,'token',d.token,'platform',d.platform,'kind',q.kind,'tenantId',q.tenant_id,'sellerId',q.seller_id,'itemId',q.item_id,'title',trim(p_subject),'body',trim(p_body));
end $$;

create function public.finish_seller_push(p_id uuid,p_status text,p_ticket text,p_error text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_worker(); q komisio_private.seller_push_deliveries;
begin
 if p_status is null or p_status not in ('accepted','failed','unconfirmed') or p_error is null or length(p_error)>80
  or (p_status='accepted' and (p_ticket is null or p_ticket !~ '^[0-9a-fA-F-]{36}$')) then raise exception 'INVALID_INPUT'; end if;
 select * into q from komisio_private.seller_push_deliveries where id=p_id for update;
 if not found then raise exception 'PUSH_NOT_FOUND'; end if;
 if q.state<>'claimed' then
  if q.state=p_status and q.ticket_id is not distinct from nullif(p_ticket,'') and q.error_code=p_error then return p_id; end if;
  raise exception 'PUSH_ALREADY_FINISHED';
 end if;
 update komisio_private.seller_push_deliveries set state=p_status,ticket_id=nullif(p_ticket,''),error_code=p_error,
  receipt_due_at=case when p_status='accepted' then clock_timestamp()+interval '15 minutes' else null end,
  finished_at=case when p_status<>'accepted' then clock_timestamp() else null end where id=p_id;
 if p_status<>'accepted' then
  perform set_config('komisio.communication_delivery','engine',true);
  update public.seller_communications set status=p_status,delivered_at=clock_timestamp() where id=p_id and channel='push' and status='queued';
  perform set_config('komisio.communication_delivery','',true);
 end if;
 if p_error='DeviceNotRegistered' then
  update komisio_private.seller_push_devices set enabled=false,token=null,revision=revision+1,generation=gen_random_uuid(),updated_at=clock_timestamp()
  where id=q.device_id and generation=q.device_generation and encode(sha256(convert_to(token,'UTF8')),'hex')=q.token_hash;
 end if;
 return p_id;
end $$;

create function public.seller_push_receipts() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_push_worker();
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
  select id,ticket_id as "ticketId",claimed_at as "claimedAt" from komisio_private.seller_push_deliveries
  where state='accepted' and receipt_due_at<=clock_timestamp() order by receipt_due_at,id limit 100
 ) x;
 return result;
end $$;
create function public.complete_seller_push_receipt(p_id uuid,p_status text,p_error text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_push_worker(); q komisio_private.seller_push_deliveries;
begin
 if p_status is null or p_status not in ('sent','failed','unconfirmed','pending') or p_error is null or length(p_error)>80 then raise exception 'INVALID_INPUT'; end if;
 select * into q from komisio_private.seller_push_deliveries where id=p_id for update;
 if not found then raise exception 'PUSH_NOT_FOUND'; end if;
 if q.state<>'accepted' then
  if q.state=p_status and q.error_code=p_error then return p_id; end if;
  raise exception 'PUSH_ALREADY_FINISHED';
 end if;
 if p_status='pending' then
  update komisio_private.seller_push_deliveries set receipt_due_at=clock_timestamp()+interval '15 minutes' where id=p_id;
  return p_id;
 end if;
 update komisio_private.seller_push_deliveries set state=p_status,error_code=p_error,finished_at=clock_timestamp() where id=p_id;
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set status=p_status,delivered_at=clock_timestamp(),provider_message_id=coalesce(q.ticket_id,'')
 where id=p_id and channel='push' and status='queued';
 perform set_config('komisio.communication_delivery','',true);
 if p_error='DeviceNotRegistered' then
  update komisio_private.seller_push_devices set enabled=false,token=null,revision=revision+1,generation=gen_random_uuid(),updated_at=clock_timestamp()
  where id=q.device_id and generation=q.device_generation and encode(sha256(convert_to(token,'UTF8')),'hex')=q.token_hash;
 end if;
 perform komisio_private.record_access(q.tenant_id,'communication.push_'||p_status,p_id,jsonb_build_object('seller_id',q.seller_id));
 return p_id;
end $$;
create function public.expire_seller_push_claims() returns integer
language plpgsql security definer set search_path='' as $$
declare q record; total integer:=0;
begin
 perform komisio_private.require_push_worker();
 for q in select id from komisio_private.seller_push_deliveries where state='claimed' and claimed_at<clock_timestamp()-interval '10 minutes' order by claimed_at limit 100 for update skip locked loop
  perform public.finish_seller_push(q.id,'unconfirmed','','WORKER_INTERRUPTED'); total:=total+1;
 end loop;
 return total;
end $$;

revoke all on function komisio_private.require_push_user(),komisio_private.push_session_valid(uuid,uuid),komisio_private.require_push_worker(),komisio_private.enqueue_seller_push(),komisio_private.seller_push_eligible(uuid) from public,anon,authenticated;
revoke all on function public.my_push_device(uuid,text),public.set_my_push_device(uuid,text,uuid,integer,text,text,text,boolean),public.seller_push_candidates(),public.claim_seller_push(uuid,text,text,text),public.finish_seller_push(uuid,text,text,text),public.seller_push_receipts(),public.complete_seller_push_receipt(uuid,text,text),public.expire_seller_push_claims() from public,anon;
grant execute on function public.my_push_device(uuid,text),public.set_my_push_device(uuid,text,uuid,integer,text,text,text,boolean),public.seller_push_candidates(),public.claim_seller_push(uuid,text,text,text),public.finish_seller_push(uuid,text,text,text),public.seller_push_receipts(),public.complete_seller_push_receipt(uuid,text,text),public.expire_seller_push_claims() to authenticated;
