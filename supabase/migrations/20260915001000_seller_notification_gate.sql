-- Transport gate for automatic mail. Staff-triggered direct messages stay separate.
create function public.allow_automatic_seller_email(p_tenant uuid,p_seller uuid,p_fact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare enabled boolean;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_fact is null or not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'INVALID_INPUT'; end if;
 select automatic_emails into enabled from public.seller_notification_preferences where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1;
 if enabled=false then
 perform komisio_private.record_access(p_tenant,'seller_email.skipped',p_fact,jsonb_build_object('seller_id',p_seller,'why','seller_opt_out'));
 return false; end if;
 return true;
end $$;
revoke all on function public.allow_automatic_seller_email(uuid,uuid,uuid) from public,anon;
grant execute on function public.allow_automatic_seller_email(uuid,uuid,uuid) to authenticated;
create function komisio_private.preserve_payout_source() returns trigger language plpgsql set search_path='' as $$
begin if new.request_source is distinct from old.request_source then raise exception 'IMMUTABLE_PAYOUT' using errcode='55000'; end if; return new; end $$;
revoke all on function komisio_private.preserve_payout_source() from public,anon,authenticated;
create trigger payouts_source_immutable before update on public.payouts for each row execute function komisio_private.preserve_payout_source();
