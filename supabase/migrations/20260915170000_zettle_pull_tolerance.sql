create or replace function public.record_zettle_pull_page(p_tenant uuid,p_id uuid,p_window uuid,p_before text,p_after text,p_purchases jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();w public.zettle_pull_windows;prior public.zettle_pull_pages;latest public.zettle_pull_pages;global_cursor text;next_global text;p jsonb;n integer;activation_cutover timestamptz;
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
 select cutover into strict activation_cutover from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id=w.merchant_id;
 select * into latest from public.zettle_pull_pages where window_id=w.id order by seq desc limit 1;
 if found and latest.purchase_count=0 then raise exception 'ZETTLE_WINDOW_COMPLETE';end if;
 if latest.cursor_after is distinct from p_before then raise exception 'ZETTLE_CURSOR_CHANGED';end if;
 n:=jsonb_array_length(p_purchases);
 if (n>0 and (p_after is null or p_after is not distinct from p_before)) or (n=0 and p_after is distinct from p_before) then raise exception 'INVALID_INPUT';end if;
 for p in select * from jsonb_array_elements(p_purchases) loop
  if not komisio_private.valid_zettle_purchase(p) then raise exception 'INVALID_INPUT';end if;
  if (p->>'occurredAt')::timestamptz<greatest(activation_cutover,w.start_at-interval '5 minutes') or (p->>'occurredAt')::timestamptz>=w.end_at+interval '5 minutes' then raise exception 'ZETTLE_WINDOW_INVALID';end if;
 end loop;
 select cursor_after into global_cursor from public.zettle_sync_runs where tenant_id=p_tenant order by seq desc limit 1;
 next_global:=case when n=0 then global_cursor else 'live:'||p_id::text end;
 perform public.record_zettle_page(p_tenant,p_id,global_cursor,next_global,p_purchases);
 insert into public.zettle_pull_pages(id,tenant_id,window_id,cursor_before,cursor_after,purchase_count,created_by) values(p_id,p_tenant,p_window,p_before,p_after,n,uid);
 return p_id;
end $$;
