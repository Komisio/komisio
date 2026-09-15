create or replace function public.begin_fortnox_send(p_tenant uuid,p_id uuid,p_export uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.fortnox_connections; e public.accounting_exports; close public.day_closes; prior public.fortnox_voucher_sends; open_row public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_export is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.export_id<>p_export or prior.actor<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',false);
 end if;
 select * into c from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if komisio_private.store_currency(p_tenant)<>'SEK' then raise exception 'FORTNOX_CURRENCY_UNSUPPORTED'; end if;
 select * into e from public.accounting_exports where tenant_id=p_tenant and id=p_export;
 if not found then raise exception 'EXPORT_NOT_FOUND'; end if;
 select * into open_row from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status in ('pending','sent');
 if found then
  if open_row.status='sent' then raise exception 'FORTNOX_ALREADY_SENT'; end if;
  raise exception 'FORTNOX_SEND_IN_PROGRESS';
 end if;
 if exists(select 1 from public.fortnox_voucher_sends where tenant_id=p_tenant and export_id=p_export and status='failed' and error_code not in ('FORTNOX_PREFLIGHT_FAILED','FORTNOX_WRONG_COMPANY')) then raise exception 'FORTNOX_OUTCOME_UNKNOWN'; end if;
 insert into public.fortnox_voucher_sends(id,tenant_id,export_id,database_number,status,actor) values(p_id,p_tenant,p_export,c.database_number,'pending',uid);
 select * into prior from public.fortnox_voucher_sends where id=p_id;
 return komisio_private.fortnox_send_state(prior)||jsonb_build_object('dispatchAllowed',true);
end $$;

create or replace function public.complete_fortnox_send(p_tenant uuid,p_id uuid,p_status text,p_series text,p_number integer,p_year integer,p_error text,p_detail text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.fortnox_voucher_sends;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status not in ('sent','failed') or (p_status='sent' and (p_number is null or p_series is null or length(p_series)=0)) or (p_status='failed' and (p_error is null or length(p_error)=0)) then raise exception 'INVALID_INPUT'; end if;
 select * into s from public.fortnox_voucher_sends where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if s.status<>'pending' then
  if s.status=p_status then return komisio_private.fortnox_send_state(s); end if;
  raise exception 'SEND_NOT_PENDING';
 end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 update public.fortnox_voucher_sends set status=p_status,voucher_series=coalesce(left(p_series,10),''),voucher_number=case when p_status='sent' then p_number end,financial_year=case when p_status='sent' then p_year end,
  error_code=case when p_status='failed' then left(p_error,80) else '' end,detail=coalesce(left(p_detail,500),''),completed_at=now() where id=s.id returning * into s;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.record_access(p_tenant,'fortnox.voucher_'||p_status,s.export_id,jsonb_build_object('send_id',s.id,'voucher_series',s.voucher_series,'voucher_number',s.voucher_number,'error_code',s.error_code));
 return komisio_private.fortnox_send_state(s);
end $$;
revoke all on function public.begin_fortnox_send(uuid,uuid,uuid),public.complete_fortnox_send(uuid,uuid,text,text,integer,integer,text,text) from public,anon;
grant execute on function public.begin_fortnox_send(uuid,uuid,uuid),public.complete_fortnox_send(uuid,uuid,text,text,integer,integer,text,text) to authenticated;
create or replace function public.record_fortnox_check(p_tenant uuid,p_kind text,p_detail jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('checked','refused') or p_detail is null or jsonb_typeof(p_detail)<>'object' then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.fortnox_event(p_tenant,p_kind,p_detail,uid);
end $$;

create function public.fortnox_automation_tenants() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 return (select coalesce(jsonb_agg(jsonb_build_object('tenantId',g.tenant_id) order by g.tenant_id),'[]') from public.automation_grants g
 where g.scope='fortnox_send' and g.disabled_at is null and g.accepted_by=auth.uid() and komisio_private.automation_allowed(g.tenant_id,'fortnox_send'));
end $$;

create function public.fortnox_automatic_exports(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('exportId',eligible.id) order by eligible.created_at,eligible.id),'[]') from (
 select exports.id,exports.created_at from public.accounting_exports exports where exports.tenant_id=p_tenant
 and not exists(select 1 from public.fortnox_voucher_sends sends where sends.tenant_id=p_tenant and sends.export_id=exports.id
 and (sends.status<>'failed' or sends.error_code<>'FORTNOX_PREFLIGHT_FAILED'))
 order by exports.created_at,exports.id limit 100) eligible);
end $$;

create function public.finish_fortnox_automatic_run(p_tenant uuid,p_id uuid,p_outcome text,p_sent integer) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); prior public.access_events; detail jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_outcome is null or p_outcome not in ('complete','partial','failed') or p_sent is null or p_sent not between 0 and 100 then raise exception 'INVALID_INPUT'; end if;
 detail:=jsonb_build_object('outcome',p_outcome,'sent',p_sent);
 select * into prior from public.access_events where tenant_id=p_tenant and target_id=p_id and action='fortnox.automatic_run';
 if found then
  if prior.actor_id<>actor or prior.detail<>detail then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 perform komisio_private.record_access(p_tenant,'fortnox.automatic_run',p_id,detail);
end $$;

create function public.fortnox_automatic_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_build_object('at',occurred_at,'outcome',detail->>'outcome','sent',detail->'sent') from public.access_events
 where tenant_id=p_tenant and action='fortnox.automatic_run' order by id desc limit 1);
end $$;
revoke all on function public.fortnox_automation_tenants(),public.fortnox_automatic_exports(uuid),public.finish_fortnox_automatic_run(uuid,uuid,text,integer),public.fortnox_automatic_status(uuid) from public,anon;
grant execute on function public.fortnox_automation_tenants(),public.fortnox_automatic_exports(uuid),public.finish_fortnox_automatic_run(uuid,uuid,text,integer),public.fortnox_automatic_status(uuid) to authenticated;
