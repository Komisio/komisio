create table public.zettle_pull_window_closures (
 id uuid primary key, tenant_id uuid not null, window_id uuid not null unique,
 reason text not null check(length(reason) between 1 and 500 and reason=btrim(reason)),
 error_code text not null default 'ZETTLE_WINDOW_ABANDONED' check(error_code='ZETTLE_WINDOW_ABANDONED'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,window_id) references public.zettle_pull_windows(tenant_id,id)
);
alter table public.zettle_pull_window_closures enable row level security;
revoke all on public.zettle_pull_window_closures from public,anon,authenticated;
grant select on public.zettle_pull_window_closures to authenticated;
create policy closure_read on public.zettle_pull_window_closures for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy closure_boundary on public.zettle_pull_window_closures as restrictive for all to authenticated using(public.tenant_role(tenant_id) in ('owner','admin')) with check(false);
create trigger closure_immutable before update or delete on public.zettle_pull_window_closures for each row execute function komisio_private.preserve_zettle();

create function public.abandon_zettle_pull_window(p_tenant uuid,p_id uuid,p_window uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.zettle_pull_window_closures; latest uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_id is null or p_window is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
 select * into prior from public.zettle_pull_window_closures where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.window_id is distinct from p_window or prior.created_by is distinct from actor or prior.reason is distinct from btrim(p_reason) then raise exception 'REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 if exists(select 1 from public.zettle_pull_window_closures where tenant_id=p_tenant and window_id=p_window) then raise exception 'ZETTLE_WINDOW_ABANDONED';end if;
 select id into latest from public.zettle_pull_windows where tenant_id=p_tenant order by seq desc limit 1;
 if latest is distinct from p_window then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 if exists(select 1 from public.zettle_pull_pages where tenant_id=p_tenant and window_id=p_window and purchase_count=0) then raise exception 'ZETTLE_WINDOW_COMPLETE';end if;
 insert into public.zettle_pull_window_closures(id,tenant_id,window_id,reason,created_by) values(p_id,p_tenant,p_window,btrim(p_reason),actor);
 perform komisio_private.record_access(p_tenant,'zettle.window_abandoned',p_window,jsonb_build_object('requestId',p_id,'reason',btrim(p_reason)));
 return p_id;
end $$;

create function public.zettle_window_closure(p_tenant uuid,p_window uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return (select jsonb_build_object('id',id,'reason',reason,'createdAt',created_at) from public.zettle_pull_window_closures where tenant_id=p_tenant and window_id=p_window);
end $$;

create function komisio_private.reject_abandoned_zettle_page() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=new.tenant_id for update;
 if exists(select 1 from public.zettle_pull_window_closures where tenant_id=new.tenant_id and window_id=new.window_id) then raise exception 'ZETTLE_WINDOW_ABANDONED';end if;
 return new;
end $$;
revoke all on function komisio_private.reject_abandoned_zettle_page() from public,anon,authenticated;
create trigger zettle_page_open_window before insert on public.zettle_pull_pages for each row execute function komisio_private.reject_abandoned_zettle_page();

create or replace function public.open_zettle_pull_window(p_tenant uuid,p_merchant uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.zettle_pull_connections; window_row public.zettle_pull_windows; start_time timestamptz; end_time timestamptz; result uuid; abandoned boolean:=false;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into connection from public.zettle_pull_connections where tenant_id=p_tenant;
 if not found then raise exception 'ZETTLE_NOT_CONNECTED';end if;
 if connection.merchant_id is distinct from p_merchant then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 select * into window_row from public.zettle_pull_windows where tenant_id=p_tenant order by seq desc limit 1;
 if found then
  abandoned:=exists(select 1 from public.zettle_pull_window_closures where tenant_id=p_tenant and window_id=window_row.id);
  if not abandoned and not exists(select 1 from public.zettle_pull_pages where window_id=window_row.id and purchase_count=0) then return window_row.id;end if;
 end if;
 end_time:=date_trunc('milliseconds',clock_timestamp())-interval '2 minutes';
 if end_time<=coalesce(window_row.end_at,connection.cutover) then return null;end if;
 start_time:=case when abandoned then window_row.end_at else greatest(connection.cutover,coalesce(window_row.end_at-interval '5 minutes',connection.cutover)) end;
 end_time:=least(end_time,start_time+interval '1 day');
 insert into public.zettle_pull_windows(tenant_id,merchant_id,start_at,end_at,created_by) values(p_tenant,p_merchant,start_time,end_time,actor) returning id into result;
 return result;
end $$;
revoke all on function public.abandon_zettle_pull_window(uuid,uuid,uuid,text),public.zettle_window_closure(uuid,uuid) from public,anon;
grant execute on function public.abandon_zettle_pull_window(uuid,uuid,uuid,text),public.zettle_window_closure(uuid,uuid) to authenticated;
