-- P2 S20 usage metering: one append-only unit record per metered event,
-- written by triggers on the existing fact tables rather than by callers, so
-- no path can use a feature without being counted. Periods are calendar
-- months in the store's time zone. The only quota today is the monthly
-- assistance quota in the store policy; other features are counted only.
create table public.usage_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 feature text not null check(feature in ('reception_assistance','seller_email','print_job')),
 units integer not null check(units>0 and units<=1000),
 period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 reference_id uuid not null,
 recorded_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create index usage_events_period on public.usage_events(tenant_id,period,feature);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon,authenticated;
grant select on public.usage_events to authenticated;
create policy usage_events_read on public.usage_events for select to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy usage_events_boundary on public.usage_events as restrictive for all to authenticated
 using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create function komisio_private.preserve_usage_event() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_USAGE_EVENT' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_usage_event() from public,anon,authenticated;
create trigger usage_events_immutable before update or delete on public.usage_events for each row execute function komisio_private.preserve_usage_event();

create function komisio_private.usage_period(p_moment timestamptz) returns text
language sql immutable set search_path='' as $$
 select to_char(p_moment at time zone 'Europe/Stockholm','YYYY-MM')
$$;
revoke all on function komisio_private.usage_period(timestamptz) from public,anon,authenticated;

-- Trigger: TG_ARGV[0] is the feature. The caller's engine function already
-- holds the tenant row lock, so the quota check and the insert are serialized.
create function komisio_private.meter_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_feature text:=tg_argv[0]; v_period text:=komisio_private.usage_period(clock_timestamp()); v_quota numeric; v_used bigint;
begin
 if v_feature='reception_assistance' then
  select (policy->>'assistanceMonthlyQuota')::numeric into v_quota from public.store_policy_versions where tenant_id=new.tenant_id order by version desc limit 1;
  if v_quota is not null then
   select coalesce(sum(units),0) into v_used from public.usage_events where tenant_id=new.tenant_id and feature='reception_assistance' and period=v_period;
   if v_used>=v_quota then raise exception 'USAGE_QUOTA_EXCEEDED'; end if;
  end if;
 end if;
 insert into public.usage_events(tenant_id,feature,units,period,reference_id,recorded_by) values(new.tenant_id,v_feature,1,v_period,new.id,auth.uid());
 return new;
end $$;
revoke all on function komisio_private.meter_usage() from public,anon,authenticated;
create trigger meter_reception_assistance after insert on public.reception_assistance_attempts for each row execute function komisio_private.meter_usage('reception_assistance');
create trigger meter_seller_email after insert on public.seller_communications for each row execute function komisio_private.meter_usage('seller_email');
create trigger meter_print_job after insert on public.print_jobs for each row execute function komisio_private.meter_usage('print_job');

-- Read: units per feature for one period (default the current month) with the
-- quota that applies, so the page never adds numbers itself.
create function public.usage_summary(p_tenant uuid,p_period text default null)
returns table(feature text,units bigint,quota numeric,period text)
language plpgsql stable security invoker set search_path='' as $$
declare chosen text:=coalesce(p_period,to_char(clock_timestamp() at time zone 'Europe/Stockholm','YYYY-MM')); body jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if chosen !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_INPUT'; end if;
 body:=public.current_store_policy(p_tenant)->'policy';
 return query
 select f.name,coalesce(sum(u.units),0)::bigint,case when f.name='reception_assistance' then (body->>'assistanceMonthlyQuota')::numeric end,chosen
 from unnest(array['reception_assistance','seller_email','print_job']) as f(name)
 left join public.usage_events u on u.tenant_id=p_tenant and u.feature=f.name and u.period=chosen
 group by f.name order by f.name;
end $$;
revoke all on function public.usage_summary(uuid,text) from public;
grant execute on function public.usage_summary(uuid,text) to authenticated;

-- Store policy: optional integer assistanceMonthlyQuota (0 blocks the feature).
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota'];
 if not(value ?& allowed) or (value-allowed-optional)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
 if value ? 'vatModeConsignmentPrivate' and (jsonb_typeof(value->'vatModeConsignmentPrivate')<>'string' or value->>'vatModeConsignmentPrivate' not in ('consignment_margin','consignment_full')) then return false; end if;
 if value ? 'vatModeStoreOwned' and (jsonb_typeof(value->'vatModeStoreOwned')<>'string' or value->>'vatModeStoreOwned' not in ('store_margin','store_full')) then return false; end if;
 if value ? 'vatRatePercent' then
  if jsonb_typeof(value->'vatRatePercent')<>'number' then return false; end if;
  n:=(value->>'vatRatePercent')::numeric;
  if n<0 or n>100 or n<>round(n,2) then return false; end if;
 end if;
 if value ? 'assistanceEnabled' and jsonb_typeof(value->'assistanceEnabled')<>'boolean' then return false; end if;
 if value ? 'assistanceMonthlyQuota' then
  if jsonb_typeof(value->'assistanceMonthlyQuota')<>'number' then return false; end if;
  n:=(value->>'assistanceMonthlyQuota')::numeric;
  if n<0 or n>1000000 or n<>trunc(n) then return false; end if;
 end if;
 foreach k in array array['commissionRatePercent','minPayoutThreshold','salePeriodDays','unsoldNotifyAfterDays'] loop
  v:=value->k;
  if jsonb_typeof(v)<>'number' then return false; end if;
  n:=(v#>>'{}')::numeric;
  if n<0 or n>9007199254740991 then return false; end if;
  if k in ('salePeriodDays','unsoldNotifyAfterDays') then
   if n<>trunc(n) or (k='salePeriodDays' and n=0) then return false; end if;
  elsif n<>round(n,2) or (k='commissionRatePercent' and n>100) then return false; end if;
 end loop;
 foreach k in array array['agreementRequiredFor','custodySources'] loop
  v:=value->k;
  if jsonb_typeof(v)<>'array' then return false; end if;
  if jsonb_array_length(v)>3 or (select count(*)<>count(distinct x) from jsonb_array_elements(v) x) then return false; end if;
  allowed:=case when k='agreementRequiredFor' then array['bag_receipt','review_publication','acceptance'] else array['staff_receipt','locker','seller_dropoff'] end;
  if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or not((x#>>'{}')=any(allowed))) then return false; end if;
 end loop;
 if jsonb_typeof(value->'markdownSteps')<>'array' then return false; end if;
 for step in select * from jsonb_array_elements(value->'markdownSteps') loop
  if jsonb_typeof(step)<>'object' then return false; end if;
  if not(step ?& array['afterDays','percent']) or (step-array['afterDays','percent'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(step->'afterDays')<>'number' or jsonb_typeof(step->'percent')<>'number' then return false; end if;
  n:=(step->>'afterDays')::numeric;
  if n<0 or n>9007199254740991 or n<>trunc(n) then return false; end if;
  n:=(step->>'percent')::numeric;
  if n<0 or n>100 or n<>round(n,2) then return false; end if;
 end loop;
 return true;
end $$;
