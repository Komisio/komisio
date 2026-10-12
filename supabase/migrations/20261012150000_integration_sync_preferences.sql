-- Integration configuration only; no item, sale or ledger writes.
create table public.integration_sync_preference_revisions (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 provider text not null check(provider in ('paypal','shopify')),
 connection_ref text not null check(length(connection_ref) between 1 and 200),
 previous_id uuid references public.integration_sync_preference_revisions(id),
 images boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 seq bigint generated always as identity
);
create index integration_sync_preference_latest on public.integration_sync_preference_revisions(tenant_id,provider,connection_ref,seq desc);
alter table public.integration_sync_preference_revisions enable row level security;
revoke all on public.integration_sync_preference_revisions from public,anon,authenticated;
grant select on public.integration_sync_preference_revisions to authenticated;
create policy integration_sync_preference_read on public.integration_sync_preference_revisions for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger integration_sync_preference_immutable before update or delete on public.integration_sync_preference_revisions for each row execute function komisio_private.preserve_correction();

create function komisio_private.sync_connection_ref(p_tenant uuid,p_provider text) returns text
language sql stable security definer set search_path='' as $$
 select case p_provider when 'paypal' then (select merchant_id::text from public.zettle_pull_connections where tenant_id=p_tenant)
 when 'shopify' then (select shop_domain from public.shopify_connections where tenant_id=p_tenant) end;
$$;
create function komisio_private.sync_preference(p_tenant uuid,p_provider text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare connection text; r public.integration_sync_preference_revisions;
begin
 connection:=komisio_private.sync_connection_ref(p_tenant,p_provider);
 if connection is null then return null;end if;
 select * into r from public.integration_sync_preference_revisions where tenant_id=p_tenant and provider=p_provider and connection_ref=connection order by seq desc limit 1;
 return jsonb_build_object('provider',p_provider,'connectionId',connection,'revision',r.id,'images',coalesce(r.images,false));
end $$;
revoke all on function komisio_private.sync_connection_ref(uuid,text),komisio_private.sync_preference(uuid,text) from public,anon,authenticated;

create function public.integration_sync_preferences(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return coalesce((select jsonb_agg(s) from (select komisio_private.sync_preference(p_tenant,p) s from unnest(array['paypal','shopify']) p) q where s is not null),'[]'::jsonb);
end $$;

create function public.save_integration_sync_preference(p_tenant uuid,p_id uuid,p_provider text,p_connection text,p_previous uuid,p_images boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.integration_sync_preference_revisions; current jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_provider is null or p_provider not in ('paypal','shopify') or p_connection is null or p_images is null then raise exception 'INVALID_INPUT';end if;
 if p_connection is distinct from komisio_private.sync_connection_ref(p_tenant,p_provider) then raise exception 'SYNC_CONNECTION_CHANGED';end if;
 select * into prior from public.integration_sync_preference_revisions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.provider is distinct from p_provider or prior.connection_ref is distinct from p_connection or prior.previous_id is distinct from p_previous or prior.images is distinct from p_images or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT';end if;
  return jsonb_build_object('provider',p_provider,'connectionId',p_connection,'revision',prior.id,'images',prior.images);
 end if;
 current:=komisio_private.sync_preference(p_tenant,p_provider);
 if (current->>'revision')::uuid is distinct from p_previous then raise exception 'SYNC_SETTINGS_CHANGED';end if;
 insert into public.integration_sync_preference_revisions(id,tenant_id,provider,connection_ref,previous_id,images,created_by) values(p_id,p_tenant,p_provider,p_connection,p_previous,p_images,uid);
 perform komisio_private.record_access(p_tenant,'integration.sync_preference_saved',p_id,jsonb_build_object('provider',p_provider,'images',p_images));
 return komisio_private.sync_preference(p_tenant,p_provider);
end $$;
revoke all on function public.integration_sync_preferences(uuid),public.save_integration_sync_preference(uuid,uuid,text,text,uuid,boolean) from public,anon;
grant execute on function public.integration_sync_preferences(uuid),public.save_integration_sync_preference(uuid,uuid,text,text,uuid,boolean) to authenticated;
