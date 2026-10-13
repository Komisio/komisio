-- Auth sends lack an idempotency key. Persist the single attempt before HTTP.
-- A lost response remains uncertain; only an explicit new welcome may resend.
alter table public.seller_communications add column activation_claimed_at timestamptz;

create function public.claim_seller_activation(p_tenant uuid,p_id uuid,p_recipient text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); message public.seller_communications;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into message from public.seller_communications where tenant_id=p_tenant and id=p_id for update;
 if not found then raise exception 'COMMUNICATION_NOT_FOUND'; end if;
 if message.queued_by is distinct from uid or message.recipient is distinct from p_recipient then raise exception 'REQUEST_CONFLICT'; end if;
 if message.template_key<>'seller.welcome' or message.template_version<>'v2' or message.kind<>'message' then raise exception 'INVALID_INPUT'; end if;
 if message.status<>'queued' or message.activation_claimed_at is not null then return false; end if;
 -- Refuse stale contact details, including a profile edit after queueing.
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=message.seller_id and lower(trim(email))=p_recipient) then raise exception 'REQUEST_CONFLICT'; end if;
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set activation_claimed_at=clock_timestamp() where id=p_id;
 perform set_config('komisio.communication_delivery','',true);
 perform komisio_private.record_access(p_tenant,'seller.activation_requested',p_id,jsonb_build_object('seller_id',message.seller_id));
 return true;
end $$;
revoke all on function public.claim_seller_activation(uuid,uuid,text) from public,anon;
grant execute on function public.claim_seller_activation(uuid,uuid,text) to authenticated;
