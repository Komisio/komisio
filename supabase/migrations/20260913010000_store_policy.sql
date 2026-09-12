-- S1 pilot policy. Values are product defaults, not financial execution rules.
create function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; n numeric; step jsonb; allowed text[];
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 allowed:=array['commissionBasis','commissionRatePercent','agreementRequiredFor','custodySources','sellerReviewMode','salePeriodDays','markdownSteps','endOfPeriodAction','unsoldNotifyAfterDays','minPayoutThreshold'];
 if not(value ?& allowed) or (value-allowed)<>'{}'::jsonb then return false; end if;
 if value->>'commissionBasis' not in ('inclusive','exclusive') or jsonb_typeof(value->'commissionBasis')<>'string'
 or value->>'sellerReviewMode' not in ('delegated','per_item') or jsonb_typeof(value->'sellerReviewMode')<>'string'
 or value->>'endOfPeriodAction' not in ('charity','return') or jsonb_typeof(value->'endOfPeriodAction')<>'string' then return false; end if;
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
revoke all on function komisio_private.valid_store_policy(jsonb) from public,anon,authenticated;

create table public.store_policy_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 policy jsonb not null check(komisio_private.valid_store_policy(policy)),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.store_policy_versions(tenant_id,id)
);
alter table public.store_policy_versions enable row level security;
create policy store_policy_read on public.store_policy_versions for select to authenticated
 using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.store_policy_versions from public,anon,authenticated;
grant select on public.store_policy_versions to authenticated;
create function komisio_private.preserve_store_policy() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_STORE_POLICY' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_store_policy() from public,anon,authenticated;
create trigger store_policy_immutable before update or delete on public.store_policy_versions
 for each row execute function komisio_private.preserve_store_policy();

create function public.current_store_policy(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy',coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":["review_publication","acceptance"],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100}'::jsonb));
end $$;
create function public.publish_store_policy(p_tenant uuid,p_id uuid,p_expected_current uuid,p_policy jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.store_policy_versions; current_version public.store_policy_versions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_store_policy(p_policy) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_policy_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid
   or prior.previous_id is distinct from p_expected_current or prior.policy is distinct from p_policy then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'POLICY_CHANGED'; end if;
 if coalesce(current_version.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 insert into public.store_policy_versions(id,tenant_id,version,previous_id,policy,created_by)
 values(p_id,p_tenant,coalesce(current_version.version,0)+1,p_expected_current,p_policy,uid);
 perform komisio_private.record_access(p_tenant,'store_policy.published',p_id,jsonb_build_object('version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;
revoke all on function public.current_store_policy(uuid),public.publish_store_policy(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.current_store_policy(uuid),public.publish_store_policy(uuid,uuid,uuid,jsonb) to authenticated;
