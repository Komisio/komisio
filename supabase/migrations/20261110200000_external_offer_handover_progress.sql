-- One bounded offer read serves the mobile list and staff queue. Keep the
-- existing owner/tenant/MFA authorization before reading any receipt evidence.
create index external_item_handover_count on public.external_item_handover_links(handover_id);
do $$ declare definition text; needle text:='''agreement'',jsonb_build_object'; begin
 definition:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_OFFER_READ'; end if;
 execute replace(definition,needle,
  '''handover'',(select jsonb_build_object(''id'',h.id,''reference'',''H-''||h.reference,''status'',h.status,
    ''receivedAt'',h.received_at,''itemCount'',(select count(*) from public.external_item_handover_links grouped where grouped.handover_id=h.id))
    from public.external_item_handover_links l join public.seller_handovers h on h.tenant_id=l.tenant_id and h.id=l.handover_id
    where l.offer_id=offer.id and l.owner_id=offer.owner_id and l.tenant_id=offer.tenant_id),
   '||needle);
end $$;
