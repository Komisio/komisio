-- Label sizes per store and label kind (owner request 2026-09-15: bag labels
-- larger, item labels smaller, configurable with a default). The store sets
-- width and height in millimetres per kind; the application renders the
-- ZPL for that size at the printer's resolution. Defaults apply until a
-- store chooses; the print job keeps the rendered program, so a later size
-- change never alters a queued or printed label.
create table public.label_formats (
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('bag','garment','item','onboarding','markdown')),
 width_mm numeric(5,1) not null check(width_mm between 20 and 120),
 height_mm numeric(5,1) not null check(height_mm between 15 and 200),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(tenant_id,kind)
);
alter table public.label_formats enable row level security;
revoke all on public.label_formats from public,anon,authenticated;
grant select on public.label_formats to authenticated;
create policy read_store on public.label_formats for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.label_formats as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);

create function komisio_private.default_label_format(p_kind text) returns jsonb language sql immutable set search_path='' as $$
 select case p_kind
  when 'bag' then jsonb_build_object('widthMm',76,'heightMm',51)
  when 'onboarding' then jsonb_build_object('widthMm',76,'heightMm',51)
  else jsonb_build_object('widthMm',57,'heightMm',32) end;
$$;
revoke all on function komisio_private.default_label_format(text) from public,anon,authenticated;

create function public.set_label_format(p_tenant uuid,p_kind text,p_width_mm numeric,p_height_mm numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('bag','garment','item','onboarding','markdown') or p_width_mm is null or p_height_mm is null
  or p_width_mm not between 20 and 120 or p_height_mm not between 15 and 200 or p_width_mm<>round(p_width_mm,1) or p_height_mm<>round(p_height_mm,1) then raise exception 'INVALID_INPUT'; end if;
 insert into public.label_formats(tenant_id,kind,width_mm,height_mm,updated_by) values(p_tenant,p_kind,p_width_mm,p_height_mm,uid)
  on conflict (tenant_id,kind) do update set width_mm=excluded.width_mm,height_mm=excluded.height_mm,updated_by=excluded.updated_by,updated_at=now();
 perform komisio_private.record_access(p_tenant,'label_format.set',null,jsonb_build_object('kind',p_kind,'width_mm',p_width_mm,'height_mm',p_height_mm));
 return jsonb_build_object('kind',p_kind,'widthMm',p_width_mm,'heightMm',p_height_mm,'custom',true);
end $$;

-- Every kind with its size: the store's own where set, the default otherwise.
create function public.label_formats(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_object_agg(k.kind,
   coalesce((select jsonb_build_object('widthMm',f.width_mm,'heightMm',f.height_mm,'custom',true) from public.label_formats f where f.tenant_id=p_tenant and f.kind=k.kind),
            komisio_private.default_label_format(k.kind)||'{"custom":false}'::jsonb))
  from unnest(array['bag','garment','item','onboarding','markdown']) as k(kind));
end $$;
revoke all on function public.set_label_format(uuid,text,numeric,numeric),public.label_formats(uuid) from public,anon;
grant execute on function public.set_label_format(uuid,text,numeric,numeric),public.label_formats(uuid) to authenticated;
