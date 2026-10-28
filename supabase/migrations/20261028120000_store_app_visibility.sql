-- Store visibility in the mobile app: owner or admin chooses whether the store
-- appears in the app's store picker. Every change is a new version naming the
-- current one. Stores are hidden until they opt in; the public read lists only
-- name and slug of stores whose current version is visible.
create table public.store_app_visibility_settings (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 visible boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.store_app_visibility_settings(tenant_id,id)
);
alter table public.store_app_visibility_settings enable row level security;
revoke all on public.store_app_visibility_settings from public,anon,authenticated;
create trigger immutable_store_app_visibility before update or delete on public.store_app_visibility_settings
 for each row execute function komisio_private.preserve_store_policy();

create function public.store_app_visibility(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.store_app_visibility_settings;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.store_app_visibility_settings where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',s.id,'visible',coalesce(s.visible,false));
end $$;

create function public.set_store_app_visibility(p_tenant uuid,p_id uuid,p_expected uuid,p_visible boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.store_app_visibility_settings; prior public.store_app_visibility_settings;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_visible is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_app_visibility_settings where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.created_by<>uid or prior.previous_id is distinct from p_expected or prior.visible<>p_visible then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into s from public.store_app_visibility_settings where tenant_id=p_tenant order by version desc limit 1;
 if s.id is distinct from p_expected then raise exception 'PROFILE_CHANGED'; end if;
 insert into public.store_app_visibility_settings(id,tenant_id,version,previous_id,visible,created_by)
 values(p_id,p_tenant,coalesce(s.version,0)+1,s.id,p_visible,uid);
 perform komisio_private.record_access(p_tenant,'store_app.visibility',p_id,jsonb_build_object('visible',p_visible));
 return p_id;
end $$;

-- The app's store picker before sign-in: id, name and slug only, nothing about
-- members, sellers or setting history. The id matches my_seller_accounts after
-- sign-in, so the app can open the chosen store's seller account.
create function public.public_app_stores() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug) order by t.name,t.slug),'[]'::jsonb)
 from public.tenants t
 where (select s.visible from public.store_app_visibility_settings s where s.tenant_id=t.id order by s.version desc limit 1)
$$;

revoke all on function public.store_app_visibility(uuid),public.set_store_app_visibility(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.store_app_visibility(uuid),public.set_store_app_visibility(uuid,uuid,uuid,boolean) to authenticated;
revoke all on function public.public_app_stores() from public;
grant execute on function public.public_app_stores() to anon,authenticated;
