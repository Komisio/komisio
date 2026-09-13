-- P3 markdown agent (owner answer to open question 4, 2026-09-13): the store
-- policy is the only markdown schedule, frozen per item at acceptance; steps
-- may be applied automatically when the store switches automaticMarkdowns
-- on (off by default); every application is the ordinary markdown event on
-- the item and every run is recorded; no notice per step. The automatic run
-- acts as the owner or admin who published the policy version that enabled
-- it, so the actor of an automatic markdown is the person who authorised it.
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[]; optional text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 optional:=array['vatModeConsignmentPrivate','vatModeStoreOwned','vatRatePercent','assistanceEnabled','assistanceMonthlyQuota','automaticSellerNotifications','automaticMarkdowns'];
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
 if value ? 'automaticSellerNotifications' and jsonb_typeof(value->'automaticSellerNotifications')<>'boolean' then return false; end if;
 if value ? 'automaticMarkdowns' and jsonb_typeof(value->'automaticMarkdowns')<>'boolean' then return false; end if;
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

create table public.markdown_runs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 mode text not null check(mode in ('manual','automatic')),
 actor uuid not null references auth.users(id),
 applied_count integer not null check(applied_count>=0),
 applied jsonb not null default '[]'::jsonb check(jsonb_typeof(applied)='array'),
 created_at timestamptz not null default now()
);
create index markdown_runs_tenant on public.markdown_runs(tenant_id,created_at desc);
alter table public.markdown_runs enable row level security;
revoke all on public.markdown_runs from public,anon,authenticated;
grant select on public.markdown_runs to authenticated;
create policy markdown_runs_read on public.markdown_runs for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create trigger markdown_runs_immutable before update or delete on public.markdown_runs for each row execute function komisio_private.preserve_payout_event();

-- One markdown as a named actor: the same arithmetic and events as apply_markdown.
create function komisio_private.markdown_item(p_tenant uuid,p_actor uuid,p_event uuid,p_item uuid,p_step integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare f jsonb; percent numeric; new_price bigint;
begin
 if exists(select 1 from public.item_events where id=p_event) then return null; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if to_jsonb(p_step) <@ (f->'appliedSteps') then raise exception 'MARKDOWN_ALREADY_APPLIED'; end if;
 if (f->>'dueStep')::integer is distinct from p_step then raise exception 'MARKDOWN_NOT_DUE'; end if;
 percent:=(f->>'duePercent')::numeric;
 new_price:=greatest((f->>'acceptedPriceOre')::bigint-komisio_private.share_ore((f->>'acceptedPriceOre')::bigint,round(percent*100)::integer),1);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,p_item,new_price,'markdown',p_actor);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_event,p_tenant,p_item,'markdown_applied',jsonb_build_object('step',p_step,'percent',percent,'priceOre',new_price),p_actor);
 return new_price;
end $$;
revoke all on function komisio_private.markdown_item(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;

-- Every due step in the store, applied as the given actor; the run is recorded once per run id.
create function komisio_private.run_markdowns(p_tenant uuid,p_run uuid,p_mode text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.items; f jsonb; price bigint; applied jsonb:='[]'::jsonb; prior public.markdown_runs;
begin
 select * into prior from public.markdown_runs where id=p_run;
 if found then
  if prior.tenant_id is distinct from p_tenant then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('runId',prior.id,'appliedCount',prior.applied_count,'applied',prior.applied,'replayed',true);
 end if;
 for item in select * from public.items i where i.tenant_id=p_tenant order by i.accepted_at,i.id loop
  f:=komisio_private.item_lifecycle(p_tenant,item.id);
  if f->>'stage'='markdown_due' then
   price:=komisio_private.markdown_item(p_tenant,p_actor,md5(p_run::text||':'||item.id::text||':'||(f->>'dueStep'))::uuid,item.id,(f->>'dueStep')::integer);
   if price is not null then applied:=applied||jsonb_build_object('itemId',item.id,'step',(f->>'dueStep')::integer,'percent',(f->>'duePercent')::numeric,'priceOre',price); end if;
  end if;
 end loop;
 insert into public.markdown_runs(id,tenant_id,mode,actor,applied_count,applied) values(p_run,p_tenant,p_mode,p_actor,jsonb_array_length(applied),applied);
 perform komisio_private.record_access(p_tenant,'markdown.run',p_run,jsonb_build_object('mode',p_mode,'applied',jsonb_array_length(applied)));
 return jsonb_build_object('runId',p_run,'appliedCount',jsonb_array_length(applied),'applied',applied,'replayed',false);
end $$;
revoke all on function komisio_private.run_markdowns(uuid,uuid,text,uuid) from public,anon,authenticated;

-- Staff: apply everything due now, as themselves.
create function public.apply_due_markdowns(p_tenant uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_INPUT'; end if;
 return komisio_private.run_markdowns(p_tenant,p_id,'manual',uid);
end $$;
revoke all on function public.apply_due_markdowns(uuid,uuid) from public,anon;
grant execute on function public.apply_due_markdowns(uuid,uuid) to authenticated;

-- The scheduled agent: one run per store and local day for stores that
-- switched automatic markdowns on, acting as the publisher of that policy.
-- Callable only by the database owner (pg_cron); never by a session role.
create function komisio_private.run_automatic_markdowns() returns jsonb
language plpgsql security definer set search_path='' as $$
declare t record; result jsonb; runs jsonb:='[]'::jsonb; today text:=to_char(now() at time zone 'Europe/Stockholm','YYYY-MM-DD');
begin
 for t in select v.tenant_id,v.created_by from public.store_policy_versions v
  where v.version=(select max(version) from public.store_policy_versions x where x.tenant_id=v.tenant_id) and (v.policy->>'automaticMarkdowns')::boolean loop
  perform 1 from public.tenants where id=t.tenant_id for update;
  result:=komisio_private.run_markdowns(t.tenant_id,md5('automatic-markdowns:'||t.tenant_id::text||':'||today)::uuid,'automatic',t.created_by);
  runs:=runs||jsonb_build_object('tenantId',t.tenant_id,'appliedCount',result->'appliedCount','replayed',result->'replayed');
 end loop;
 return jsonb_build_object('day',today,'runs',runs);
end $$;
revoke all on function komisio_private.run_automatic_markdowns() from public,anon,authenticated;

-- Daily at 03:15 UTC where pg_cron is installed (hosted); elsewhere the operator schedules the call.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('komisio-automatic-markdowns','15 3 * * *','select komisio_private.run_automatic_markdowns()');
 end if;
end $cron$;
