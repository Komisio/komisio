-- Host activity overview: for every store, how much it is used, next to
-- its plan state on the host page. Counts only; no store content leaves
-- the tenant. Platform hosts (people) read it; nothing is written.
create function public.host_activity_overview()
returns table(tenant_id uuid,members integer,sellers integer,items integer,sales_30d integer,last_activity timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return query select t.id,
  (select count(*)::int from public.tenant_members m where m.tenant_id=t.id),
  (select count(*)::int from public.sellers s where s.tenant_id=t.id),
  (select count(*)::int from public.items i where i.tenant_id=t.id),
  (select count(*)::int from public.sales sa where sa.tenant_id=t.id and sa.status='completed' and sa.occurred_at>=now()-interval '30 days'),
  (select max(e.occurred_at) from public.access_events e where e.tenant_id=t.id)
  from public.tenants t order by t.created_at desc limit 500;
end $$;
revoke all on function public.host_activity_overview() from public,anon;
grant execute on function public.host_activity_overview() to authenticated;
