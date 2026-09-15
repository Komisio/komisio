create table public.label_print_rules (
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('bag','garment','item','onboarding','markdown')),
 printer_id uuid not null,
 copies integer not null check(copies between 1 and 20),
 enabled boolean not null default false,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,kind),
 foreign key(tenant_id,printer_id) references public.printers(tenant_id,id)
);
alter table public.label_print_rules enable row level security;
revoke all on public.label_print_rules from public,anon,authenticated;
grant select on public.label_print_rules to authenticated;
create policy read_store on public.label_print_rules for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy store_boundary on public.label_print_rules as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);

create function komisio_private.guard_label_print_rule() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('komisio.label_rule_transition',true) is distinct from 'engine' or tg_op='DELETE' then raise exception 'IMMUTABLE_LABEL_PRINT_RULE' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.guard_label_print_rule() from public,anon,authenticated;
create trigger engine_only before insert or update or delete on public.label_print_rules for each row execute function komisio_private.guard_label_print_rule();

create function public.label_print_rules(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'printerId',printer_id,'copies',copies,'enabled',enabled) order by kind),'[]') from public.label_print_rules where tenant_id=p_tenant);
end $$;

create function public.set_label_print_rule(p_tenant uuid,p_kind text,p_printer uuid,p_copies integer,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.label_print_rules; active boolean; result jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('bag','garment','item','onboarding','markdown') or p_printer is null or p_copies is null or p_copies not between 1 and 20 or p_enabled is null then raise exception 'INVALID_INPUT'; end if;
 select printers.active into active from public.printers where tenant_id=p_tenant and id=p_printer;
 if not found then raise exception 'PRINTER_NOT_FOUND'; end if;
 if p_enabled and not active then raise exception 'PRINTER_INACTIVE'; end if;
 result:=jsonb_build_object('kind',p_kind,'printerId',p_printer,'copies',p_copies,'enabled',p_enabled);
 select * into prior from public.label_print_rules where tenant_id=p_tenant and kind=p_kind;
 if found and prior.printer_id=p_printer and prior.copies=p_copies and prior.enabled=p_enabled then return result; end if;
 perform set_config('komisio.label_rule_transition','engine',true);
 insert into public.label_print_rules(tenant_id,kind,printer_id,copies,enabled,updated_by) values(p_tenant,p_kind,p_printer,p_copies,p_enabled,actor)
 on conflict(tenant_id,kind) do update set printer_id=excluded.printer_id,copies=excluded.copies,enabled=excluded.enabled,updated_by=actor,updated_at=clock_timestamp();
 perform set_config('komisio.label_rule_transition','',true);
 perform komisio_private.record_access(p_tenant,'label_print_rule.changed',p_printer,result);
 return result;
end $$;
revoke all on function public.label_print_rules(uuid),public.set_label_print_rule(uuid,text,uuid,integer,boolean) from public,anon;
grant execute on function public.label_print_rules(uuid),public.set_label_print_rule(uuid,text,uuid,integer,boolean) to authenticated;
