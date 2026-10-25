-- #626: explicit immutable seller type. Old rows and old registrations stay private.
alter table public.sellers add column seller_type text not null default 'private'
 check(seller_type in ('private','business'));

create function komisio_private.valid_business_details(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; maximum integer;
begin
 if p is null or jsonb_typeof(p)<>'object' or
  (p-array['companyName','organisationNumber','vatNumber','vatRegistered','contactPerson','billingAddress','invoiceEmail','invoiceReference'])<>'{}' then return false; end if;
 for k in select jsonb_object_keys(p) loop
  if k='vatRegistered' then
   if jsonb_typeof(p->k)<>'boolean' then return false; end if;
  else
   maximum:=case k when 'companyName' then 160 when 'organisationNumber' then 80 when 'vatNumber' then 80 when 'billingAddress' then 500 when 'invoiceEmail' then 254 else 120 end;
   if jsonb_typeof(p->k)<>'string' or length(p->>k)>maximum then return false; end if;
  end if;
 end loop;
 return coalesce(p->>'invoiceEmail','')='' or p->>'invoiceEmail' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
end $$;
revoke all on function komisio_private.valid_business_details(jsonb) from public,anon,authenticated;

do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_seller_profile(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_seller_profile(', 'FUNCTION komisio_private.valid_seller_profile_before_business(');
end $$;
revoke all on function komisio_private.valid_seller_profile_before_business(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_seller_profile(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_seller_profile_before_business(p-array['sellerType','business'])
  and (not(p ? 'sellerType') or (jsonb_typeof(p->'sellerType')='string' and p->>'sellerType' in ('private','business')))
  and (not(p ? 'business') or (p->>'sellerType'='business' and komisio_private.valid_business_details(p->'business'))),false)
$$;

create function komisio_private.guard_seller_type() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and new.seller_type is distinct from old.seller_type then raise exception 'SELLER_TYPE_IMMUTABLE'; end if;
 if new.profile is not null and coalesce(new.profile->>'sellerType','private')<>new.seller_type then raise exception 'SELLER_TYPE_IMMUTABLE'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_seller_type() from public,anon,authenticated;
create trigger seller_type_immutable before insert or update on public.sellers for each row execute function komisio_private.guard_seller_type();

-- Preserve boolean business facts while normalizing only strings. All existing
-- authorization, optimistic revision, erasure and replay checks remain in place.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.save_seller_profile(uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if position('select jsonb_object_agg(key,trim(value)) into normalized from jsonb_each_text(p_profile);' in definition)=0 then raise exception 'UNEXPECTED_PROFILE_FUNCTION'; end if;
 definition:=replace(definition,
  'select jsonb_object_agg(key,trim(value)) into normalized from jsonb_each_text(p_profile);',
  'select jsonb_object_agg(key,case when jsonb_typeof(value)=''string'' then to_jsonb(trim(value#>>''{}'')) else value end) into normalized from jsonb_each(p_profile);
   if normalized ? ''business'' then normalized:=jsonb_set(normalized,''{business}'',(select jsonb_object_agg(key,case when jsonb_typeof(value)=''string'' then to_jsonb(trim(value#>>''{}'')) else value end) from jsonb_each(normalized->''business''))); end if;');
 definition:=replace(definition,'if s.profile_revision<>p_expected then',
  'if coalesce(normalized->>''sellerType'',''private'')<>s.seller_type then raise exception ''SELLER_TYPE_IMMUTABLE''; end if; if s.profile_revision<>p_expected then');
 definition:=replace(definition,'''name'',s.name,''email'',s.email', '''sellerType'',s.seller_type,''name'',s.name,''email'',s.email');
 execute definition;
end $$;

create or replace function public.register_seller_with_profile(p_tenant uuid,p_id uuid,p_profile jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); kind text:=coalesce(p_profile->>'sellerType','private');
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_seller_profile(p_profile) then raise exception 'INVALID_INPUT'; end if;
 if kind='business' then
  insert into public.sellers(id,tenant_id,name,email,phone,created_by,seller_type)
   values(p_id,p_tenant,trim(p_profile->>'name'),lower(trim(p_profile->>'email')),trim(p_profile->>'phone'),uid,kind)
   on conflict(id) do nothing;
  if found then perform komisio_private.record_access(p_tenant,'seller.registered',p_id,jsonb_build_object('sellerType',kind)); end if;
 end if;
 perform public.register_seller(p_tenant,p_id,p_profile->>'name',p_profile->>'email',p_profile->>'phone');
 if (select seller_type from public.sellers where tenant_id=p_tenant and id=p_id) is distinct from kind then raise exception 'REQUEST_CONFLICT'; end if;
 perform public.save_seller_profile(p_tenant,p_id,p_id,0,p_profile);
 return p_id;
end $$;

-- Business defaults participate in the same acceptance-time terms snapshot.
-- Explicit seller overrides still win; store policy/rate/agreement are unchanged.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.effective_seller_terms(uuid,uuid)'::regprocedure);
 if position('coalesce(latest.commission_basis,current_policy->''policy''->>''commissionBasis'')' in definition)=0 then raise exception 'UNEXPECTED_SELLER_TERMS'; end if;
 definition:=replace(definition,'coalesce(latest.commission_basis,current_policy->''policy''->>''commissionBasis'')',
  'coalesce(latest.commission_basis,case when (select seller_type from public.sellers where tenant_id=p_tenant and id=p_seller)=''business'' then ''exclusive'' else current_policy->''policy''->>''commissionBasis'' end)');
 execute definition;
end $$;
