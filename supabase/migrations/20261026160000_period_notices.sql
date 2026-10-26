-- #636: default-on transactional notices, with an operator-managed narrow actor.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_period_notices(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_period_notices(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_store_policy_before_period_notices(value-'automaticPeriodNotifications') and
  (not(value ? 'automaticPeriodNotifications') or jsonb_typeof(value->'automaticPeriodNotifications')='boolean'),false)
$$;

-- No tenant memberships or broad table reads are granted to this identity.
create table komisio_private.period_notice_worker (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null references auth.users(id), enabled boolean not null,
 enabled_since timestamptz not null, cursor_item uuid
);
revoke all on komisio_private.period_notice_worker from public,anon,authenticated;
create function komisio_private.configure_period_notice_worker(p_user uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_enabled is null or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
 then raise exception 'INVALID_WORKER'; end if;
 insert into komisio_private.period_notice_worker(user_id,enabled,enabled_since) values(p_user,p_enabled,clock_timestamp())
 on conflict(singleton) do update set user_id=excluded.user_id,enabled=excluded.enabled,
  enabled_since=case when excluded.enabled and (not period_notice_worker.enabled or period_notice_worker.user_id<>excluded.user_id)
   then excluded.enabled_since else period_notice_worker.enabled_since end,cursor_item=null;
end $$;
revoke all on function komisio_private.configure_period_notice_worker(uuid,boolean) from public,anon,authenticated;
create function komisio_private.require_period_notice_worker() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if not exists(select 1 from komisio_private.period_notice_worker where user_id=uid and enabled)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return uid;
end $$;
revoke all on function komisio_private.require_period_notice_worker() from public,anon,authenticated;

alter table public.seller_communications drop constraint seller_communications_kind_check;
alter table public.seller_communications add constraint seller_communications_kind_check
 check(kind in ('item_accepted','item_sold','payout_approved','payout_paid','statement_issued','message','period_ending','period_ended'));
create table komisio_private.period_notice_claims (
 item_id uuid not null references public.items(id), cycle_id uuid not null,
 kind text not null check(kind in ('period_ending','period_ended')),
 communication_id uuid not null unique references public.seller_communications(id),
 due_at timestamptz not null, primary key(item_id,cycle_id,kind)
);
revoke all on komisio_private.period_notice_claims from public,anon,authenticated;
create trigger period_notice_claims_immutable before update or delete on komisio_private.period_notice_claims
 for each row execute function komisio_private.preserve_ledger();

-- Recompute eligibility rather than persisting stale pending recipients. The
-- bounded cursor revisits unclaimed candidates; only a committed claim sends.
create function komisio_private.period_notice_facts(p_item uuid,p_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; seller public.sellers; policy public.store_policy_versions; pref public.seller_notification_preferences;
 f jsonb; profile jsonb; cutover timestamptz; ends timestamptz; due timestamptz; reopened public.item_events;
 cycle uuid; ended_at timestamptz; enabled_at timestamptz; locale text; title text;
begin
 if p_kind not in ('period_ending','period_ended') then return null; end if;
 select enabled_since into cutover from komisio_private.period_notice_worker where enabled;
 if cutover is null then return null; end if;
 select * into item from public.items where id=p_item and ownership='consignment';
 if not found then return null; end if;
 select * into seller from public.sellers where tenant_id=item.tenant_id and id=item.seller_id;
 if not found or seller.privacy_closed_at is not null or seller.email='' then return null; end if;
 select * into policy from public.store_policy_versions where tenant_id=item.tenant_id order by version desc limit 1;
 if coalesce((policy.policy->>'automaticPeriodNotifications')::boolean,true)=false then return null; end if;
 -- The first enabled policy after the most recent disabled version is the
 -- store cutover. Unrelated policy edits must not suppress a pending notice.
 select min(created_at) into enabled_at from public.store_policy_versions
 where tenant_id=item.tenant_id and version>(select max(version) from public.store_policy_versions
  where tenant_id=item.tenant_id and store_policy_versions.policy->>'automaticPeriodNotifications'='false');
 cutover:=greatest(cutover,enabled_at);
 select * into pref from public.seller_notification_preferences where tenant_id=item.tenant_id and seller_id=item.seller_id order by seq desc limit 1;
 if pref.automatic_emails=false then return null; end if;
 select min(created_at) into enabled_at from public.seller_notification_preferences
 where tenant_id=item.tenant_id and seller_id=item.seller_id and seq>(select max(seq) from public.seller_notification_preferences
  where tenant_id=item.tenant_id and seller_id=item.seller_id and not automatic_emails);
 cutover:=greatest(cutover,enabled_at);
 if exists(select 1 from public.item_events where item_id=p_item and kind='period_ended' and detail->>'action'='transfer') then return null; end if;
 f:=komisio_private.item_lifecycle(item.tenant_id,p_item);
 if (f->>'sold')::boolean then return null; end if;
 select * into reopened from public.item_events where item_id=p_item and kind='period_reopened' order by occurred_at desc,id desc limit 1;
 cycle:=coalesce(reopened.id,item.id);
 if exists(select 1 from komisio_private.period_notice_claims where item_id=p_item and cycle_id=cycle and kind=p_kind) then return null; end if;
 ends:=(f->>'periodEnd')::timestamptz;
 select min(occurred_at) into ended_at from public.item_events where item_id=p_item and kind='period_ended'
  and occurred_at>coalesce(reopened.occurred_at,'-infinity'::timestamptz);
 if p_kind='period_ending' then
  if (f->>'ended')::boolean or ends<=clock_timestamp() then return null; end if;
  due:=(((ends at time zone 'Europe/Stockholm')::date-7)::timestamp at time zone 'Europe/Stockholm');
 else due:=least(ends,ended_at);
 end if;
 if due is null or due<cutover or due>clock_timestamp() then return null; end if;
 select v.profile into profile from public.store_profile_versions v where tenant_id=item.tenant_id order by version desc limit 1;
 locale:=coalesce(seller.profile->>'language',profile->>'language',policy.policy->>'communicationLanguage','en');
 if locale not in ('sv','en','no','dk','fi','de','es','it') then locale:='en'; end if;
 title:=coalesce(nullif(komisio_private.item_title(item.tenant_id,item.id)->>'title',''),item.id::text);
 return jsonb_build_object('itemId',item.id,'tenantId',item.tenant_id,'sellerId',seller.id,'cycleId',cycle,'kind',p_kind,
  'dueAt',due,'periodEnd',ends,'recipient',lower(seller.email),'locale',locale,'policyId',policy.id,'preferenceId',pref.id,
  'storeName',(select left(name,120) from public.tenants where id=item.tenant_id),'sellerName',left(seller.name,120),'itemLabel',left(title,120));
end $$;
revoke all on function komisio_private.period_notice_facts(uuid,text) from public,anon,authenticated;

create function public.period_notice_candidates() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cursor_id uuid; item record; kind text; facts jsonb; result jsonb:='[]'; checked integer:=0;
begin
 perform komisio_private.require_period_notice_worker();
 select cursor_item into cursor_id from komisio_private.period_notice_worker for update;
 for item in select id from public.items where cursor_id is null or id>cursor_id order by id limit 40 loop
  checked:=checked+1; cursor_id:=item.id;
  foreach kind in array array['period_ending','period_ended'] loop
   facts:=komisio_private.period_notice_facts(item.id,kind);
   if facts is not null then result:=result||jsonb_build_array(facts); end if;
  end loop;
 end loop;
 update komisio_private.period_notice_worker set cursor_item=case when checked<40 then null else cursor_id end;
 return jsonb_build_object('candidates',result,'checked',checked,'wrapped',checked<40);
end $$;

create function public.claim_period_notice(p_id uuid,p_facts jsonb,p_locale text,p_subject text,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_period_notice_worker(); current_facts jsonb; tenant uuid;
begin
 if p_id is null or p_facts is null or jsonb_typeof(p_facts)<>'object' or octet_length(p_facts::text)>8000
  or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
  or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 8000
 then raise exception 'INVALID_INPUT'; end if;
 select tenant_id into tenant from public.items where id=(p_facts->>'itemId')::uuid;
 if tenant is null then return null; end if;
 perform 1 from public.tenants where id=tenant for update;
 current_facts:=komisio_private.period_notice_facts((p_facts->>'itemId')::uuid,p_facts->>'kind');
 if current_facts is null or current_facts is distinct from p_facts then return null; end if;
 -- English is the whole-template fallback; other substituted locales are refused.
 if p_locale<>current_facts->>'locale' and p_locale<>'en' then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from public.seller_communications c where c.tenant_id=tenant and c.queued_at>now()-interval '1 day')
  >=(select case when t.created_at>now()-make_interval(days=>s.email_trust_days) then s.email_new_cap else s.email_daily_cap end
    from public.platform_settings s,public.tenants t where t.id=tenant) then return null; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by)
 values(p_id,tenant,(current_facts->>'sellerId')::uuid,current_facts->>'kind',current_facts->>'kind','v2',p_locale,current_facts->>'recipient',trim(p_subject),trim(p_body),'item',(current_facts->>'itemId')::uuid,uid);
 insert into komisio_private.period_notice_claims(item_id,cycle_id,kind,communication_id,due_at)
 values((current_facts->>'itemId')::uuid,(current_facts->>'cycleId')::uuid,current_facts->>'kind',p_id,(current_facts->>'dueAt')::timestamptz);
 perform komisio_private.record_access(tenant,'communication.queued',p_id,jsonb_build_object('seller_id',current_facts->>'sellerId','kind',current_facts->>'kind','reference_kind','item'));
 return p_id;
end $$;

create function public.finish_period_notice(p_id uuid,p_status text,p_provider_message_id text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_period_notice_worker(); row public.seller_communications; pid text:=coalesce(trim(p_provider_message_id),'');
begin
 if p_status is null or p_status not in ('sent','restricted','manual','unconfirmed','failed') or length(pid)>200 then raise exception 'INVALID_INPUT'; end if;
 select * into row from public.seller_communications where id=p_id and queued_by=uid and kind in ('period_ending','period_ended');
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenants where id=row.tenant_id for update;
 select * into row from public.seller_communications where id=p_id;
 if row.status<>'queued' then
  if row.status=p_status and row.provider_message_id=pid then return p_id; end if;
  raise exception 'COMMUNICATION_DECIDED';
 end if;
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set status=p_status,provider_message_id=pid,delivered_at=clock_timestamp() where id=p_id;
 perform set_config('komisio.communication_delivery','',true);
 perform komisio_private.record_access(row.tenant_id,'communication.'||p_status,p_id,jsonb_build_object('seller_id',row.seller_id,'kind',row.kind));
 return p_id;
end $$;
revoke all on function public.period_notice_candidates(),public.claim_period_notice(uuid,jsonb,text,text,text),public.finish_period_notice(uuid,text,text) from public,anon;
grant execute on function public.period_notice_candidates(),public.claim_period_notice(uuid,jsonb,text,text,text),public.finish_period_notice(uuid,text,text) to authenticated;
