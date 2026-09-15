create sequence komisio_private.fortnox_connection_revision as bigint no cycle;
revoke all on sequence komisio_private.fortnox_connection_revision from public,anon,authenticated;
alter table public.fortnox_connections add column revision bigint not null default nextval('komisio_private.fortnox_connection_revision');

create function komisio_private.advance_fortnox_revision() returns trigger
language plpgsql set search_path='' as $$
begin
 new.revision:=nextval('komisio_private.fortnox_connection_revision');
 return new;
end $$;
revoke all on function komisio_private.advance_fortnox_revision() from public,anon,authenticated;
create trigger fortnox_revision before update on public.fortnox_connections for each row execute function komisio_private.advance_fortnox_revision();

create or replace function public.read_fortnox_connection(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare connection public.fortnox_connections;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into connection from public.fortnox_connections where tenant_id=p_tenant;
 if not found then return null; end if;
 return jsonb_build_object('databaseNumber',connection.database_number,'companyName',connection.company_name,'organisationNumber',connection.organisation_number,'cipher',connection.cipher,'scope',connection.scope,'expiresAt',connection.expires_at,'connectedAt',connection.connected_at,'refreshedAt',connection.refreshed_at,'revision',connection.revision::text);
end $$;

create function public.refresh_fortnox_tokens(p_tenant uuid,p_revision bigint,p_cipher jsonb,p_scope text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); connection public.fortnox_connections; detail jsonb; next_revision bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') and not komisio_private.automation_allowed(p_tenant,'fortnox_send') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_revision is null or p_revision<1 or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data'])
  or length(coalesce(p_scope,''))>500 or p_expires_at is null or not isfinite(p_expires_at) then raise exception 'INVALID_INPUT'; end if;
 select * into connection from public.fortnox_connections where tenant_id=p_tenant;
 if not found then raise exception 'FORTNOX_NOT_CONNECTED'; end if;
 if connection.revision<>p_revision then
  detail:=jsonb_build_object('reason','FORTNOX_CONNECTION_CHANGED','expected_revision',p_revision::text,'current_revision',connection.revision::text);
  perform komisio_private.fortnox_event(p_tenant,'refused',detail,actor);
  perform komisio_private.record_access(p_tenant,'fortnox.refused',p_tenant,detail);
  return jsonb_build_object('error','FORTNOX_CONNECTION_CHANGED');
 end if;
 perform set_config('komisio.fortnox_transition','engine',true);
 update public.fortnox_connections set cipher=p_cipher,scope=coalesce(p_scope,''),expires_at=p_expires_at,refreshed_at=clock_timestamp()
  where tenant_id=p_tenant returning revision into next_revision;
 perform set_config('komisio.fortnox_transition','',true);
 detail:=jsonb_build_object('database_number',connection.database_number,'previous_revision',p_revision::text,'revision',next_revision::text);
 perform komisio_private.fortnox_event(p_tenant,'refreshed',detail,actor);
 perform komisio_private.record_access(p_tenant,'fortnox.refreshed',p_tenant,detail);
 return jsonb_build_object('status','refreshed','revision',next_revision::text);
end $$;
revoke all on function public.refresh_fortnox_tokens(uuid,bigint,jsonb,text,timestamptz),public.read_fortnox_connection(uuid) from public,anon;
grant execute on function public.refresh_fortnox_tokens(uuid,bigint,jsonb,text,timestamptz),public.read_fortnox_connection(uuid) to authenticated;
