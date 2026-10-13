-- Use PostgreSQL built-ins so isolated and self-hosted installations do not
-- depend on the extension schema chosen for pgcrypto. Three random UUIDs
-- provide more than 256 bits of source entropy before SHA-256 compression.
create or replace function public.prepare_seller_activation_email(p_tenant uuid,p_id uuid,p_recipient text) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); message public.seller_communications; ticket text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into message from public.seller_communications where tenant_id=p_tenant and id=p_id for update;
 if not found then raise exception 'COMMUNICATION_NOT_FOUND'; end if;
 if message.queued_by is distinct from uid or message.recipient is distinct from p_recipient then raise exception 'REQUEST_CONFLICT'; end if;
 if message.template_key<>'seller.welcome' or message.template_version<>'v3' or message.kind<>'message' then raise exception 'INVALID_INPUT'; end if;
 if message.status<>'queued' or message.activation_claimed_at is not null then return null; end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=message.seller_id and lower(trim(email))=p_recipient) then raise exception 'REQUEST_CONFLICT'; end if;
 ticket:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set activation_claimed_at=clock_timestamp(),activation_email_ticket_hash=encode(sha256(convert_to(ticket,'UTF8')),'hex') where id=p_id;
 perform set_config('komisio.communication_delivery','',true);
 perform komisio_private.record_access(p_tenant,'seller.activation_requested',p_id,jsonb_build_object('seller_id',message.seller_id));
 return ticket;
end $$;
revoke all on function public.prepare_seller_activation_email(uuid,uuid,text) from public,anon;
grant execute on function public.prepare_seller_activation_email(uuid,uuid,text) to authenticated;

-- Auth has no staff session. Possession of the 256-bit capability grants only
-- consumption of this one message, for its frozen recipient, for five minutes.
create or replace function public.consume_seller_activation_email(p_ticket text,p_recipient text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare message public.seller_communications;
begin
 if p_ticket is null or p_ticket!~'^[a-f0-9]{64}$' then return null; end if;
 select * into message from public.seller_communications
 where activation_email_ticket_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') for update;
 if not found or message.recipient is distinct from lower(trim(p_recipient))
  or message.status<>'queued' or message.template_key<>'seller.welcome' or message.template_version<>'v3'
  or message.activation_email_consumed_at is not null or message.activation_claimed_at is null
  or message.activation_claimed_at<clock_timestamp()-interval '5 minutes' then return null; end if;
 if not exists(select 1 from public.sellers where tenant_id=message.tenant_id and id=message.seller_id and lower(trim(email))=message.recipient) then return null; end if;
 perform set_config('komisio.communication_delivery','engine',true);
 update public.seller_communications set activation_email_consumed_at=clock_timestamp() where id=message.id;
 perform set_config('komisio.communication_delivery','',true);
 return jsonb_build_object('id',message.id,'locale',message.locale,'subject',message.subject,'body',message.body);
end $$;
revoke all on function public.consume_seller_activation_email(text,text) from public;
grant execute on function public.consume_seller_activation_email(text,text) to anon,authenticated;
