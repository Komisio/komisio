-- Operational credentials only; immutable access and synchronization history stays intact.
alter table public.paypal_credentials
 add column auth_method text not null default 'retired',
 add column expires_at timestamptz,
 add column revision bigint not null default 0,
 add column refresh_claim uuid,
 add column refresh_started_at timestamptz;
revoke execute on function public.store_paypal_credentials(uuid,uuid,jsonb) from authenticated;

create function komisio_private.require_paypal_access(p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin')
 and not coalesce(komisio_private.automation_allowed(p_tenant,'zettle_pull'),false)
 and not coalesce(komisio_private.catalog_allowed(p_tenant,'paypal'),false)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function komisio_private.require_paypal_access(uuid) from public,anon,authenticated;

create or replace function public.read_paypal_credentials(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.paypal_credentials;
begin
 perform komisio_private.require_paypal_access(p_tenant);
 select * into c from public.paypal_credentials where tenant_id=p_tenant and auth_method='oauth';
 if not found then return null;end if;
 return jsonb_build_object('merchantId',c.merchant_id,'cipher',c.cipher,'expiresAt',c.expires_at,'revision',c.revision::text);
end $$;

create function public.paypal_connection_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.paypal_credentials;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into c from public.paypal_credentials where tenant_id=p_tenant;
 return jsonb_build_object('connected',coalesce(c.auth_method='oauth',false),'merchantId',c.merchant_id,
 'revision',coalesce(c.revision,0)::text,'reconnectRequired',coalesce(c.refresh_started_at<now()-interval '1 minute',false));
end $$;

create function public.store_paypal_oauth(p_tenant uuid,p_merchant uuid,p_cipher jsonb,p_expires_at timestamptz,p_revision bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); c public.paypal_credentials;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_merchant is null or p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or octet_length(p_cipher::text)>100000 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 day' or p_revision is null then raise exception 'INVALID_INPUT';end if;
 select * into c from public.paypal_credentials where tenant_id=p_tenant for update;
 if (c.merchant_id is not null and c.merchant_id<>p_merchant) or exists(select 1 from public.zettle_pull_connections where tenant_id=p_tenant and merchant_id<>p_merchant) then raise exception 'ZETTLE_WRONG_MERCHANT';end if;
 if coalesce(c.revision,0)<>p_revision then raise exception 'PAYPAL_CONNECTION_CHANGED';end if;
 insert into public.paypal_credentials(tenant_id,merchant_id,cipher,connected_by,auth_method,expires_at,revision)
 values(p_tenant,p_merchant,p_cipher,actor,'oauth',p_expires_at,1)
 on conflict(tenant_id) do update set cipher=excluded.cipher,connected_by=actor,connected_at=now(),auth_method='oauth',expires_at=p_expires_at,revision=paypal_credentials.revision+1,refresh_claim=null,refresh_started_at=null;
 perform komisio_private.record_access(p_tenant,'paypal.oauth_connected',p_tenant,jsonb_build_object('merchant_id',p_merchant));
end $$;

-- Claim before calling the rotating-token endpoint. Abandoned claims are never retried.
create function public.claim_paypal_refresh(p_tenant uuid,p_revision bigint,p_claim uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.paypal_credentials;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 perform komisio_private.require_paypal_access(p_tenant);
 if p_claim is null or p_revision is null then raise exception 'INVALID_INPUT';end if;
 select * into c from public.paypal_credentials where tenant_id=p_tenant and auth_method='oauth' for update;
 if not found then raise exception 'ZETTLE_NOT_CONNECTED';end if;
 if c.revision<>p_revision then return jsonb_build_object('status','changed');end if;
 if c.expires_at>now()+interval '60 seconds' then return jsonb_build_object('status','valid');end if;
 if c.refresh_claim is not null then return jsonb_build_object('status',case when c.refresh_started_at<now()-interval '1 minute' then 'unknown' else 'busy' end);end if;
 update public.paypal_credentials set refresh_claim=p_claim,refresh_started_at=now() where tenant_id=p_tenant;
 return jsonb_build_object('status','claimed');
end $$;

create function public.finish_paypal_refresh(p_tenant uuid,p_revision bigint,p_claim uuid,p_cipher jsonb,p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant for update;
 perform komisio_private.require_paypal_access(p_tenant);
 if p_cipher is null or jsonb_typeof(p_cipher)<>'object' or not (p_cipher ?& array['iv','tag','data']) or octet_length(p_cipher::text)>100000 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 day' then raise exception 'INVALID_INPUT';end if;
 update public.paypal_credentials set cipher=p_cipher,expires_at=p_expires_at,revision=revision+1,refresh_claim=null,refresh_started_at=null
 where tenant_id=p_tenant and auth_method='oauth' and revision=p_revision and refresh_claim=p_claim;
 if not found then raise exception 'PAYPAL_CONNECTION_CHANGED';end if;
 perform komisio_private.record_access(p_tenant,'paypal.oauth_refreshed',p_tenant,jsonb_build_object('revision',p_revision+1));
end $$;

create function public.disconnect_paypal(p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 update public.paypal_credentials set auth_method='disconnected',cipher='{"iv":"","tag":"","data":""}',expires_at=null,revision=revision+1,refresh_claim=null,refresh_started_at=null where tenant_id=p_tenant and auth_method='oauth';
 if found then perform komisio_private.record_access(p_tenant,'paypal.oauth_disconnected',p_tenant,'{}');end if;
end $$;

revoke all on function public.paypal_connection_status(uuid),public.store_paypal_oauth(uuid,uuid,jsonb,timestamptz,bigint),public.claim_paypal_refresh(uuid,bigint,uuid),public.finish_paypal_refresh(uuid,bigint,uuid,jsonb,timestamptz),public.disconnect_paypal(uuid) from public,anon;
grant execute on function public.paypal_connection_status(uuid),public.store_paypal_oauth(uuid,uuid,jsonb,timestamptz,bigint),public.claim_paypal_refresh(uuid,bigint,uuid),public.finish_paypal_refresh(uuid,bigint,uuid,jsonb,timestamptz),public.disconnect_paypal(uuid) to authenticated;
