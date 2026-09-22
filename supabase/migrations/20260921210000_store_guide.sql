-- Private onboarding context, never an active commercial policy.
create function komisio_private.valid_store_guide(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; allowed jsonb; choices jsonb; consignment boolean; rental boolean;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['intake','goods','pricing','period','pos','channels'])
 or (value-array['intake','goods','pricing','period','pos','channels'])<>'{}'::jsonb then return false; end if;
 foreach k in array array['intake','goods','pricing','period','pos','channels'] loop
  choices:=value->k;
  if jsonb_typeof(choices)<>'array' then return false; end if;
  if jsonb_array_length(choices)>7 or (k<>'period' and jsonb_array_length(choices)=0) then return false; end if;
  allowed:=case k
   when 'intake' then '["single","bags","owned","new","pickup","space","other"]'::jsonb
   when 'goods' then '["clothes","kids","home","furniture","hobby","mixed","other"]'::jsonb
   when 'pricing' then '["store","together","seller","suggestion","both","later"]'::jsonb
   when 'period' then '["collect","donate","extend","individual","later"]'::jsonb
   when 'pos' then '["zettle","shopify","other","later"]'::jsonb
   when 'channels' then '["shop","web","social","market","later"]'::jsonb end;
  if not(allowed @> choices) or exists(select 1 from jsonb_array_elements(choices) e where jsonb_typeof(e)<>'string') then return false; end if;
  if (select count(distinct e) from jsonb_array_elements(choices) e)<>jsonb_array_length(choices) then return false; end if;
  if k in ('pricing','pos') and jsonb_array_length(choices)<>1 then return false; end if;
  if choices ? 'later' and jsonb_array_length(choices)<>1 then return false; end if;
 end loop;
 consignment:=(value->'intake') ?| array['single','bags','pickup'];
 rental:=(value->'intake') ? 'space' and not consignment and not((value->'intake') ?| array['owned','new']);
 if consignment<>(jsonb_array_length(value->'period')>0) then return false; end if;
 if rental then return ' ["store","seller","both","later"]'::jsonb @> (value->'pricing'); end if;
 if consignment then return '["store","together","seller","later"]'::jsonb @> (value->'pricing'); end if;
 return '["store","suggestion","later"]'::jsonb @> (value->'pricing');
end $$;
revoke all on function komisio_private.valid_store_guide(jsonb) from public,anon,authenticated;

create table public.store_guide_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 schema_version integer not null default 1 check(schema_version=1),
 previous_id uuid,
 answers jsonb not null check(komisio_private.valid_store_guide(answers)),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.store_guide_versions(tenant_id,id)
);
alter table public.store_guide_versions enable row level security;
revoke all on public.store_guide_versions from public,anon,authenticated;
grant select on public.store_guide_versions to authenticated;
create policy store_guide_read on public.store_guide_versions for select to authenticated
 using(tenant_id in(select public.user_tenant_ids()) and public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger store_guide_versions_immutable before update or delete on public.store_guide_versions
 for each row execute function komisio_private.preserve_payout_event();

create function public.current_store_guide(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v public.store_guide_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into v from public.store_guide_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',v.id,'version',coalesce(v.version,0),'answers',v.answers,'savedAt',v.created_at);
end $$;
revoke all on function public.current_store_guide(uuid) from public,anon;
grant execute on function public.current_store_guide(uuid) to authenticated;

create function public.save_store_guide(p_tenant uuid,p_id uuid,p_expected_current uuid,p_answers jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.store_guide_versions; current_version public.store_guide_versions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_store_guide(p_answers) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_guide_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid
   or prior.previous_id is distinct from p_expected_current or prior.answers is distinct from p_answers then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.store_guide_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'GUIDE_CHANGED'; end if;
 insert into public.store_guide_versions(id,tenant_id,version,previous_id,answers,created_by)
 values(p_id,p_tenant,coalesce(current_version.version,0)+1,p_expected_current,p_answers,uid);
 perform komisio_private.record_access(p_tenant,'store_guide.saved',p_id,jsonb_build_object('version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;
revoke all on function public.save_store_guide(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_store_guide(uuid,uuid,uuid,jsonb) to authenticated;
