-- Label templates per store and kind (owner request 2026-09-15: the ZPL
-- editor of legacy Komisio). An owner or admin writes the ZPL program with
-- placeholders; every dynamic value is still sanitised before it enters
-- the program, so a store name or a note can never alter it. Versions are
-- append-only; the newest active version is used, "built-in" means no
-- active version. The queued job keeps the rendered program.
create table public.label_templates (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('bag','garment','item','onboarding','markdown')),
 version integer not null check(version>0),
 name text not null check(length(name) between 1 and 80),
 zpl text not null check(length(zpl) between 4 and 20000),
 active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,kind,version)
);
create index label_templates_current on public.label_templates(tenant_id,kind,version desc);
alter table public.label_templates enable row level security;
revoke all on public.label_templates from public,anon,authenticated;
grant select on public.label_templates to authenticated;
create policy read_store on public.label_templates for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.label_templates as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
create trigger immutable before update or delete on public.label_templates for each row execute function komisio_private.preserve_shopify();

-- A new version of the store's template for one kind. The program must be one label (^XA ... ^XZ); printer
-- control commands (~) are refused because they change the printer, not the label.
create function public.set_label_template(p_tenant uuid,p_kind text,p_name text,p_zpl text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); n text:=trim(coalesce(p_name,'')); z text:=trim(coalesce(p_zpl,'')); next_version integer; result public.label_templates;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('bag','garment','item','onboarding','markdown') or length(n) not between 1 and 80 or length(z) not between 4 and 20000 then raise exception 'INVALID_INPUT'; end if;
 if z !~ '^\^XA' or z !~ '\^XZ$' then raise exception 'LABEL_TEMPLATE_FRAME'; end if;
 if z ~ '~' then raise exception 'LABEL_TEMPLATE_CONTROL'; end if;
 if z !~ '\{reference\}' then raise exception 'LABEL_TEMPLATE_REFERENCE'; end if;
 select coalesce(max(version),0)+1 into next_version from public.label_templates where tenant_id=p_tenant and kind=p_kind;
 insert into public.label_templates(tenant_id,kind,version,name,zpl,active,created_by) values(p_tenant,p_kind,next_version,n,z,true,uid) returning * into result;
 perform komisio_private.record_access(p_tenant,'label_template.published',result.id,jsonb_build_object('kind',p_kind,'version',next_version));
 return jsonb_build_object('id',result.id,'kind',p_kind,'version',next_version,'name',n);
end $$;

-- Back to the built-in layout: a new inactive version records the choice.
create function public.reset_label_template(p_tenant uuid,p_kind text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); current public.label_templates; next_version integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('bag','garment','item','onboarding','markdown') then raise exception 'INVALID_INPUT'; end if;
 select * into current from public.label_templates where tenant_id=p_tenant and kind=p_kind order by version desc limit 1;
 if not found or not current.active then return false; end if;
 next_version:=current.version+1;
 insert into public.label_templates(tenant_id,kind,version,name,zpl,active,created_by) values(p_tenant,p_kind,next_version,current.name,current.zpl,false,uid);
 perform komisio_private.record_access(p_tenant,'label_template.reset',current.id,jsonb_build_object('kind',p_kind,'version',next_version));
 return true;
end $$;

-- The current template per kind (null where the built-in layout applies), for the editor and the print route.
create function public.label_templates(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_object_agg(t.kind,case when t.active then jsonb_build_object('id',t.id,'version',t.version,'name',t.name,'zpl',t.zpl,'createdAt',t.created_at) else null end)
  from (select distinct on (kind) * from public.label_templates where tenant_id=p_tenant order by kind,version desc) t),'{}'::jsonb);
end $$;
revoke all on function public.set_label_template(uuid,text,text,text),public.reset_label_template(uuid,text),public.label_templates(uuid) from public,anon;
grant execute on function public.set_label_template(uuid,text,text,text),public.reset_label_template(uuid,text),public.label_templates(uuid) to authenticated;
