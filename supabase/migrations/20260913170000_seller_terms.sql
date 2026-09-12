-- P1 S2: per-seller commission terms as append-only versions. Sellers stay
-- immutable; a null column means "use the store policy". effective_seller_terms
-- merges the latest version with the current policy and is what acceptance (S4)
-- freezes onto an item.
create table public.seller_terms_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 seller_id uuid not null,
 version integer not null check(version>0),
 previous_id uuid,
 commission_basis text check(commission_basis in ('inclusive','exclusive')),
 commission_rate_percent numeric(5,2) check(commission_rate_percent>=0 and commission_rate_percent<=100),
 notes text not null default '' check(length(notes)<=500),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,seller_id,version),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,previous_id) references public.seller_terms_versions(tenant_id,id)
);
create index seller_terms_latest on public.seller_terms_versions(tenant_id,seller_id,version desc);
alter table public.seller_terms_versions enable row level security;
create policy seller_terms_read on public.seller_terms_versions for select to authenticated
 using(tenant_id in(select public.user_tenant_ids()));
revoke all on public.seller_terms_versions from public,anon,authenticated;
grant select on public.seller_terms_versions to authenticated;
create function komisio_private.preserve_seller_terms() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_SELLER_TERMS' using errcode='55000'; end $$;
revoke all on function komisio_private.preserve_seller_terms() from public,anon,authenticated;
create trigger seller_terms_immutable before update or delete on public.seller_terms_versions
 for each row execute function komisio_private.preserve_seller_terms();

create function public.publish_seller_terms(p_tenant uuid,p_id uuid,p_seller uuid,p_expected_current uuid,p_basis text,p_rate numeric,p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_terms_versions; current_version public.seller_terms_versions; n text:=trim(coalesce(p_notes,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or length(n)>500
  or (p_basis is not null and p_basis not in ('inclusive','exclusive'))
  or (p_rate is not null and (p_rate='NaN'::numeric or p_rate<0 or p_rate>100 or p_rate<>round(p_rate,2))) then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into prior from public.seller_terms_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.created_by is distinct from uid
   or prior.previous_id is distinct from p_expected_current or prior.commission_basis is distinct from p_basis
   or prior.commission_rate_percent is distinct from p_rate or prior.notes is distinct from n then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.seller_terms_versions where tenant_id=p_tenant and seller_id=p_seller order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'SELLER_TERMS_CHANGED'; end if;
 if coalesce(current_version.version,0)>=2147483646 then raise exception 'INVALID_INPUT'; end if;
 insert into public.seller_terms_versions(id,tenant_id,seller_id,version,previous_id,commission_basis,commission_rate_percent,notes,created_by)
 values(p_id,p_tenant,p_seller,coalesce(current_version.version,0)+1,p_expected_current,p_basis,p_rate,n,uid);
 perform komisio_private.record_access(p_tenant,'seller_terms.published',p_id,jsonb_build_object('seller_id',p_seller,'version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;

-- Read merge of policy and the seller's latest version. Not a frozen fact: S4 copies
-- the result onto the item at acceptance, and nothing here is edited afterwards.
create function public.effective_seller_terms(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_policy jsonb; latest public.seller_terms_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 current_policy:=public.current_store_policy(p_tenant);
 select * into latest from public.seller_terms_versions where tenant_id=p_tenant and seller_id=p_seller order by version desc limit 1;
 return jsonb_build_object(
  'sellerTermsId',latest.id,
  'version',coalesce(latest.version,0),
  'notes',coalesce(latest.notes,''),
  'commissionBasis',coalesce(latest.commission_basis,current_policy->'policy'->>'commissionBasis'),
  'commissionRatePercent',coalesce(latest.commission_rate_percent,(current_policy->'policy'->>'commissionRatePercent')::numeric),
  'overrides',jsonb_build_object('commissionBasis',latest.commission_basis is not null,'commissionRatePercent',latest.commission_rate_percent is not null),
  'storePolicyId',current_policy->'id',
  'storePolicyVersion',current_policy->'version');
end $$;
revoke all on function public.publish_seller_terms(uuid,uuid,uuid,uuid,text,numeric,text),public.effective_seller_terms(uuid,uuid) from public,anon;
grant execute on function public.publish_seller_terms(uuid,uuid,uuid,uuid,text,numeric,text),public.effective_seller_terms(uuid,uuid) to authenticated;
