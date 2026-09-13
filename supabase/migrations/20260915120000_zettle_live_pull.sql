-- Append-only transport state; receipt/sale facts still use record_zettle_page.
create table public.zettle_pull_connections (
 tenant_id uuid primary key references public.tenants(id), merchant_id uuid not null,
 cutover timestamptz not null, created_by uuid not null references auth.users(id),
 unique(tenant_id,merchant_id)
);
create table public.zettle_pull_windows (
 id uuid primary key default gen_random_uuid(), seq bigint generated always as identity,
 tenant_id uuid not null, merchant_id uuid not null, start_at timestamptz not null, end_at timestamptz not null,
 created_by uuid not null references auth.users(id), check(start_at<end_at), check(end_at-start_at<=interval '1 day'),
 foreign key(tenant_id,merchant_id) references public.zettle_pull_connections(tenant_id,merchant_id), unique(tenant_id,id)
);
create index zettle_pull_window_latest on public.zettle_pull_windows(tenant_id,seq desc);
create table public.zettle_pull_pages (
 id uuid primary key references public.zettle_sync_runs(id), seq bigint generated always as identity,
 tenant_id uuid not null, window_id uuid not null, cursor_before text, cursor_after text,
 purchase_count integer not null check(purchase_count between 0 and 100), created_by uuid not null references auth.users(id),
 foreign key(tenant_id,window_id) references public.zettle_pull_windows(tenant_id,id)
);
create index zettle_pull_page_latest on public.zettle_pull_pages(window_id,seq desc);
create unique index zettle_pull_one_completion on public.zettle_pull_pages(window_id) where purchase_count=0;
do $$ declare t text;begin
 foreach t in array array['zettle_pull_connections','zettle_pull_windows','zettle_pull_pages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy zettle_pull_read on public.%I for select to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin''))',t);
  execute format('create policy zettle_pull_boundary on public.%I as restrictive for all to authenticated using(public.tenant_role(tenant_id) in (''owner'',''admin'')) with check(false)',t);
  execute format('create trigger zettle_pull_immutable before update or delete on public.%I for each row execute function komisio_private.preserve_zettle()',t);
 end loop;
end $$;
create function public.enable_zettle_pull(p_tenant uuid,p_merchant uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();c public.zettle_pull_connections;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_merchant is null then raise exception 'INVALID_INPUT';end if;
 select * into c from public.zettle_pull_connections where tenant_id=p_tenant;
 if found then
  if c.merchant_id<>p_merchant then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
  return c.cutover;
 end if;
 insert into public.zettle_pull_connections values(p_tenant,p_merchant,date_trunc('milliseconds',clock_timestamp()),uid) returning * into c;
 perform komisio_private.record_access(p_tenant,'zettle.pull_enabled',p_tenant,jsonb_build_object('cutover',c.cutover));
 return c.cutover;
end $$;
create function public.open_zettle_pull_window(p_tenant uuid,p_merchant uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();c public.zettle_pull_connections;w public.zettle_pull_windows;s timestamptz;e timestamptz;result uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into c from public.zettle_pull_connections where tenant_id=p_tenant;
 if not found then raise exception 'ZETTLE_NOT_CONNECTED';end if;
 if c.merchant_id is distinct from p_merchant then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into w from public.zettle_pull_windows where tenant_id=p_tenant order by seq desc limit 1;
 if found and not exists(select 1 from public.zettle_pull_pages where window_id=w.id and purchase_count=0) then return w.id;end if;
 e:=date_trunc('milliseconds',clock_timestamp())-interval '2 minutes';
 if e<=coalesce(w.end_at,c.cutover) then return null;end if;
 s:=greatest(c.cutover,coalesce(w.end_at-interval '5 minutes',c.cutover));e:=least(e,s+interval '1 day');
 insert into public.zettle_pull_windows(tenant_id,merchant_id,start_at,end_at,created_by) values(p_tenant,p_merchant,s,e,uid) returning id into result;
 return result;
end $$;
create function public.record_zettle_pull_page(p_tenant uuid,p_id uuid,p_window uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();w public.zettle_pull_windows;prior public.zettle_pull_pages;latest public.zettle_pull_pages;global_cursor text;next_global text;p jsonb;n integer;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_window is null or p_purchases is null or jsonb_typeof(p_purchases)<>'array' or jsonb_array_length(p_purchases)>100 or length(p_before)>1000 or length(p_after)>1000 or p_before='' or p_after='' then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_pull_pages where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.window_id is distinct from p_window or prior.cursor_before is distinct from p_before or prior.cursor_after is distinct from p_after or prior.created_by is distinct from uid or (select page from public.zettle_sync_runs where id=p_id) is distinct from p_purchases then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 select * into w from public.zettle_pull_windows where tenant_id=p_tenant and id=p_window;
 if not found then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 select * into latest from public.zettle_pull_pages where window_id=w.id order by seq desc limit 1;
 if found and latest.purchase_count=0 then raise exception 'ZETTLE_WINDOW_COMPLETE';end if;
 if latest.cursor_after is distinct from p_before then raise exception 'ZETTLE_CURSOR_CHANGED';end if;
 n:=jsonb_array_length(p_purchases);
 if (n>0 and (p_after is null or p_after is not distinct from p_before)) or (n=0 and p_after is distinct from p_before) then raise exception 'INVALID_INPUT';end if;
 for p in select * from jsonb_array_elements(p_purchases) loop
  if not komisio_private.valid_zettle_purchase(p) then raise exception 'INVALID_INPUT';end if;
  if (p->>'occurredAt')::timestamptz<w.start_at or (p->>'occurredAt')::timestamptz>=w.end_at then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 end loop;
 select cursor_after into global_cursor from public.zettle_sync_runs where tenant_id=p_tenant order by seq desc limit 1;
 next_global:=case when n=0 then global_cursor else 'live:'||p_id::text end;
 perform public.record_zettle_page(p_tenant,p_id,global_cursor,next_global,p_purchases);
 insert into public.zettle_pull_pages(id,tenant_id,window_id,cursor_before,cursor_after,purchase_count,created_by) values(p_id,p_tenant,p_window,p_before,p_after,n,uid);
 return p_id;
end $$;
revoke all on function public.enable_zettle_pull(uuid,uuid),public.open_zettle_pull_window(uuid,uuid),public.record_zettle_pull_page(uuid,uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.enable_zettle_pull(uuid,uuid),public.open_zettle_pull_window(uuid,uuid),public.record_zettle_pull_page(uuid,uuid,uuid,text,text,jsonb) to authenticated;
