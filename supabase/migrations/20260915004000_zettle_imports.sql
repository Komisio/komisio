-- S12: minimized import evidence and append-only matching, not sales.
create table public.zettle_imports (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 external_id uuid not null, occurred_at timestamptz not null,currency text not null,amount_ore bigint not null,
 blocked_reason text,lines jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,external_id),unique(tenant_id,id)
);
create table public.unmatched_sale_lines (
 tenant_id uuid not null,import_id uuid not null,line_no integer not null,reason text not null,
 primary key(import_id,line_no),foreign key(tenant_id,import_id) references public.zettle_imports(tenant_id,id)
);
create table public.zettle_line_resolutions (
 id uuid primary key,tenant_id uuid not null,import_id uuid not null,line_no integer not null,item_id uuid not null,
 revision integer not null,source text not null check(source in ('label','staff')),created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(import_id,revision),foreign key(tenant_id,import_id) references public.zettle_imports(tenant_id,id),foreign key(tenant_id,item_id) references public.items(tenant_id,id)
);
create table public.zettle_sync_runs (
 id uuid primary key,seq bigint generated always as identity,tenant_id uuid not null references public.tenants(id),cursor_before text,cursor_after text,
 page jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create index zettle_resolution_latest on public.zettle_line_resolutions(import_id,line_no,revision desc);
create index zettle_sync_latest on public.zettle_sync_runs(tenant_id,seq desc);
create index zettle_import_list on public.zettle_imports(tenant_id,created_at desc,id);
alter table public.zettle_imports enable row level security;
revoke all on public.zettle_imports from anon,authenticated;
grant select on public.zettle_imports to authenticated;
create policy zettle_read on public.zettle_imports for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy zettle_boundary on public.zettle_imports as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
alter table public.unmatched_sale_lines enable row level security;
revoke all on public.unmatched_sale_lines from anon,authenticated;
grant select on public.unmatched_sale_lines to authenticated;
create policy zettle_read on public.unmatched_sale_lines for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy zettle_boundary on public.unmatched_sale_lines as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
alter table public.zettle_line_resolutions enable row level security;
revoke all on public.zettle_line_resolutions from anon,authenticated;
grant select on public.zettle_line_resolutions to authenticated;
create policy zettle_read on public.zettle_line_resolutions for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy zettle_boundary on public.zettle_line_resolutions as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);
alter table public.zettle_sync_runs enable row level security;
revoke all on public.zettle_sync_runs from anon,authenticated;
grant select on public.zettle_sync_runs to authenticated;
create policy zettle_read on public.zettle_sync_runs for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create policy zettle_boundary on public.zettle_sync_runs as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly')) with check(false);

create function komisio_private.valid_zettle_purchase(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare line jsonb;n integer:=0;total numeric:=0;
begin
 if p is null or jsonb_typeof(p)<>'object' or not(p ?& array['externalId','occurredAt','currency','amountOre','blockedReason','lines']) or (p-array['externalId','occurredAt','currency','amountOre','blockedReason','lines'])<>'{}'::jsonb then return false;end if;
 if jsonb_typeof(p->'externalId')<>'string' or (p->>'externalId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'occurredAt')<>'string' or not isfinite((p->>'occurredAt')::timestamptz) then return false;end if;
 if jsonb_typeof(p->'currency')<>'string' or length(p->>'currency') not between 1 and 10 or (p->>'amountOre') !~ '^-?[0-9]{1,11}$' or jsonb_typeof(p->'amountOre')<>'number' then return false;end if;
 if p->'blockedReason'<>'null'::jsonb and p->>'blockedReason' not in ('source','refund','currency','discount','service_charge','quantity','product_type','amount') then return false;end if;
 if jsonb_typeof(p->'lines')<>'array' or jsonb_array_length(p->'lines') not between 1 and 50 then return false;end if;
 for line in select * from jsonb_array_elements(p->'lines') loop
  n:=n+1;
  if jsonb_typeof(line)<>'object' or not(line ?& array['lineNo','reference','labelConflict','description','priceOre']) or (line-array['lineNo','reference','labelConflict','description','priceOre'])<>'{}'::jsonb then return false;end if;
  if line->'lineNo'<>to_jsonb(n) or jsonb_typeof(line->'labelConflict')<>'boolean' or jsonb_typeof(line->'description')<>'string' or length(line->>'description')>120 then return false;end if;
  if line->'reference'<>'null'::jsonb and (jsonb_typeof(line->'reference')<>'string' or (line->>'reference') !~ '^I-[0-9A-F]{8}$') then return false;end if;
  if jsonb_typeof(line->'priceOre')<>'number' or (line->>'priceOre') !~ '^-?[0-9]{1,11}$' then return false;end if;
  total:=total+(line->>'priceOre')::numeric;
  if p->'blockedReason'='null'::jsonb and (line->>'priceOre')::numeric<=0 then return false;end if;
 end loop;
 if p->'blockedReason'='null'::jsonb and (p->>'currency'<>'SEK' or total<>(p->>'amountOre')::numeric or total<=0) then return false;end if;
 return true;
exception when others then return false;
end $$;

create function public.record_zettle_page(p_tenant uuid,p_id uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_sync_runs;latest text;p jsonb;stored public.zettle_imports;line jsonb;matches uuid[];rev integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or length(p_before)>1000 or length(p_after)>1000 or p_before='' or p_after='' or p_purchases is null or jsonb_typeof(p_purchases)<>'array' or jsonb_array_length(p_purchases)>100 then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_sync_runs where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.page is distinct from p_purchases or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT';end if;
  return prior.id;
 end if;
 select cursor_after into latest from public.zettle_sync_runs where tenant_id=p_tenant order by seq desc limit 1;
 if latest is distinct from p_before then raise exception 'ZETTLE_CURSOR_CHANGED';end if;
 if jsonb_array_length(p_purchases)>0 and (p_after is null or p_after is not distinct from p_before) then raise exception 'INVALID_INPUT';end if;
 if jsonb_array_length(p_purchases)=0 and p_after is distinct from p_before then raise exception 'INVALID_INPUT';end if;
 for p in select * from jsonb_array_elements(p_purchases) loop
  if not komisio_private.valid_zettle_purchase(p) then raise exception 'INVALID_INPUT';end if;
  select * into stored from public.zettle_imports where tenant_id=p_tenant and external_id=(p->>'externalId')::uuid;
  if found then
   if stored.occurred_at is distinct from (p->>'occurredAt')::timestamptz or stored.currency is distinct from p->>'currency' or stored.amount_ore is distinct from (p->>'amountOre')::bigint or stored.blocked_reason is distinct from p->>'blockedReason' or stored.lines is distinct from p->'lines' then raise exception 'ZETTLE_PURCHASE_CONFLICT';end if;
   continue;
  end if;
  insert into public.zettle_imports(tenant_id,external_id,occurred_at,currency,amount_ore,blocked_reason,lines,created_by)
   values(p_tenant,(p->>'externalId')::uuid,(p->>'occurredAt')::timestamptz,p->>'currency',(p->>'amountOre')::bigint,p->>'blockedReason',p->'lines',uid) returning * into stored;
  rev:=0;
  for line in select * from jsonb_array_elements(stored.lines) loop
   select array_agg(i.id order by i.id) into matches from public.items i where i.tenant_id=p_tenant and 'I-'||upper(left(i.id::text,8))=line->>'reference';
   if cardinality(matches)=1 and not (line->>'labelConflict')::boolean then
    rev:=rev+1;
    insert into public.zettle_line_resolutions(id,tenant_id,import_id,line_no,item_id,revision,source,created_by) values(gen_random_uuid(),p_tenant,stored.id,(line->>'lineNo')::integer,matches[1],rev,'label',uid);
   else
    insert into public.unmatched_sale_lines(tenant_id,import_id,line_no,reason) values(p_tenant,stored.id,(line->>'lineNo')::integer,case when (line->>'labelConflict')::boolean then 'conflicting_labels' when cardinality(matches)>1 then 'ambiguous_label' else 'missing_item' end);
   end if;
  end loop;
 end loop;
 insert into public.zettle_sync_runs(id,tenant_id,cursor_before,cursor_after,page,created_by) values(p_id,p_tenant,p_before,p_after,p_purchases,uid);
 perform komisio_private.record_access(p_tenant,'zettle.page_received',p_id,jsonb_build_object('purchases',jsonb_array_length(p_purchases)));
 return p_id;
end $$;
create function public.resolve_zettle_line(p_tenant uuid,p_id uuid,p_import uuid,p_line integer,p_expected integer,p_item uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();prior public.zettle_line_resolutions;receipt public.zettle_imports;latest integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_import is null or p_line is null or p_expected is null or p_expected<0 or p_expected>=999999999 or p_item is null then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_line_resolutions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.import_id is distinct from p_import or prior.line_no is distinct from p_line or prior.revision is distinct from p_expected+1 or prior.item_id is distinct from p_item or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 if not found or p_line<1 or p_line>jsonb_array_length(receipt.lines) then raise exception 'ZETTLE_IMPORT_NOT_FOUND';end if;
 if exists(select 1 from public.sales where tenant_id=p_tenant and provider='zettle' and external_id=receipt.external_id::text) then raise exception 'ZETTLE_ALREADY_RECORDED';end if;
 if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND';end if;
 select coalesce(max(revision),0) into latest from public.zettle_line_resolutions where import_id=p_import;
 if latest<>p_expected then raise exception 'ZETTLE_MATCH_CHANGED';end if;
 insert into public.zettle_line_resolutions(id,tenant_id,import_id,line_no,item_id,revision,source,created_by) values(p_id,p_tenant,p_import,p_line,p_item,latest+1,'staff',uid);
 perform komisio_private.record_access(p_tenant,'zettle.line_resolved',p_import,jsonb_build_object('line',p_line,'revision',latest+1));
 return p_id;
end $$;
revoke all on function komisio_private.valid_zettle_purchase(jsonb) from public,anon,authenticated;
revoke all on function public.record_zettle_page(uuid,uuid,text,text,jsonb),public.resolve_zettle_line(uuid,uuid,uuid,integer,integer,uuid) from public,anon;
grant execute on function public.record_zettle_page(uuid,uuid,text,text,jsonb),public.resolve_zettle_line(uuid,uuid,uuid,integer,integer,uuid) to authenticated;

create function komisio_private.preserve_zettle() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_ZETTLE' using errcode='55000';end $$;
revoke all on function komisio_private.preserve_zettle() from public,anon,authenticated;
create trigger zettle_imports_immutable before update or delete on public.zettle_imports for each row execute function komisio_private.preserve_zettle();
create trigger unmatched_sale_lines_immutable before update or delete on public.unmatched_sale_lines for each row execute function komisio_private.preserve_zettle();
create trigger zettle_line_resolutions_immutable before update or delete on public.zettle_line_resolutions for each row execute function komisio_private.preserve_zettle();
create trigger zettle_sync_runs_immutable before update or delete on public.zettle_sync_runs for each row execute function komisio_private.preserve_zettle();
