-- Reopen the exact delivery, including payment sources derived solely from
-- its immutable current/baseline closes, rather than showing the full SIE target.
create function public.fortnox_sends_page(p_tenant uuid,p_export uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('payout_sources',
  komisio_private.fortnox_send_state(s)->'payoutSources') order by s.created_at desc,s.id),'[]')
  from (select * from public.fortnox_voucher_sends where tenant_id=p_tenant and (p_export is null or export_id=p_export)
   order by created_at desc,id limit case when p_export is null then 200 else 1 end) s);
end $$;
revoke all on function public.fortnox_sends_page(uuid,uuid) from public,anon;
grant execute on function public.fortnox_sends_page(uuid,uuid) to authenticated;
