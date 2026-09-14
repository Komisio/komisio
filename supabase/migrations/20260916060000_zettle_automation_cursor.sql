create or replace function public.prepare_zettle_automatic_pull(p_tenant uuid,p_merchant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); run_id uuid; window_id uuid; window_row public.zettle_pull_windows; before_cursor text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=p_merchant) then raise exception 'ZETTLE_NOT_CONNECTED'; end if;
 run_id:=md5('zettle-cron:'||p_tenant::text||':'||floor(extract(epoch from clock_timestamp())/600)::text)::uuid;
 if exists(select 1 from public.access_events where tenant_id=p_tenant and action='zettle.automatic_started' and target_id=run_id) then return null; end if;
 window_id:=public.open_zettle_pull_window(p_tenant,p_merchant);
 if window_id is not null then
  select * into strict window_row from public.zettle_pull_windows where tenant_id=p_tenant and id=window_id;
  select page.cursor_after into before_cursor from public.zettle_pull_pages page where page.tenant_id=p_tenant and page.window_id=window_row.id order by page.seq desc limit 1;
 end if;
 perform komisio_private.record_access(p_tenant,'zettle.automatic_started',run_id,jsonb_build_object('windowId',window_id));
 return jsonb_build_object('id',run_id,'windowId',window_id,'startDate',window_row.start_at,'endDate',window_row.end_at,'cursor',before_cursor,'currency',komisio_private.store_currency(p_tenant));
end $$;
