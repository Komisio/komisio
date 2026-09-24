-- Internal presentation notes, independent of public profiles and financial policy.
alter table public.tenants add column flow_notes jsonb not null default '{}'::jsonb;
alter table public.tenants add column flow_revision integer not null default 0;

create function public.read_store_flow(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_build_object('revision',flow_revision,'notes',flow_notes) from public.tenants where id=p_tenant);
end $$;

create function public.save_store_flow(p_tenant uuid,p_revision integer,p_notes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_revision integer; entry record;
begin
 perform komisio_private.require_identity();
 select flow_revision into current_revision from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_notes is null or jsonb_typeof(p_notes)<>'object' or p_revision is null or p_revision<0 then raise exception 'INVALID_INPUT'; end if;
 for entry in select * from jsonb_each(p_notes) loop
   if entry.key not in ('arrive','receive','wait','register','review','label','sell','unsold','payout') or jsonb_typeof(entry.value)<>'string' or length(entry.value#>>'{}')>2000 then raise exception 'INVALID_INPUT'; end if;
 end loop;
 if current_revision<>p_revision then raise exception 'STALE_VERSION'; end if;
 update public.tenants set flow_notes=p_notes,flow_revision=flow_revision+1 where id=p_tenant;
 perform komisio_private.record_access(p_tenant,'store.flow.updated',p_tenant);
 return public.read_store_flow(p_tenant);
end $$;
revoke all on function public.read_store_flow(uuid),public.save_store_flow(uuid,integer,jsonb) from public,anon;
grant execute on function public.read_store_flow(uuid),public.save_store_flow(uuid,integer,jsonb) to authenticated;
