-- Use the existing central identity and explicit seller binding only for this read.
-- Other seller reads, bank changes and ordinary store accounts use their own gates.
do $$
declare d text; guard text:='perform komisio_private.require_seller(p_tenant,p_seller);';
begin
 d:=pg_get_functiondef('public.my_seller_payouts_page(uuid,uuid,integer)'::regprocedure);
 if strpos(d,guard)=0 then raise exception 'UNEXPECTED_PAYOUT_READ_GUARD'; end if;
 execute replace(d,guard,$body$
 if exists (
  select 1 from public.sellers s join public.platform_settings p on p.only_row and p.central_app_tenant_id=s.tenant_id
  where s.tenant_id=p_tenant and s.id=p_seller and s.external_owner_id=auth.uid() and s.privacy_closed_at is null
 ) then
  perform komisio_private.external_identity_owner();
 else
  perform komisio_private.require_seller(p_tenant,p_seller);
 end if;
 $body$);
end $$;
