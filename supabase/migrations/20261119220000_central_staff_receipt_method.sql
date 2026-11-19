-- Keep the submitted instruction immutable; a purchase receipt or guarantee
-- records the final decision for one item after it is physically received.
alter table public.external_item_requests drop constraint external_item_requests_check1,
 add constraint external_item_sale_method check (sale_method='consignment' or
 (approval_mode='fixed' and sale_method in ('direct_purchase','staff_decides')));

create function komisio_private.resolved_central_sale_method(p_request uuid,p_submitted text) returns text
language sql stable set search_path='' as $$
 select case when p_submitted<>'staff_decides' then p_submitted
 when exists(select 1 from komisio_private.central_direct_purchases where request_id=p_request) then 'direct_purchase'
 when exists(select 1 from public.external_item_guarantees g join public.external_item_offers o on o.id=g.offer_id where o.request_id=p_request) then 'consignment'
 end
$$;
revoke all on function komisio_private.resolved_central_sale_method(uuid,text) from public,anon,authenticated;

do $$ declare d text; needle text; sig text; begin
 d:=pg_get_functiondef('public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid,text)'::regprocedure);
 needle:='p_sale_method not in (''direct_purchase'',''consignment'')';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_SUBMISSION'; end if;
 execute replace(d,needle,'p_sale_method not in (''direct_purchase'',''consignment'',''staff_decides'')');
 d:=pg_get_functiondef('public.inspect_central_direct_purchase(uuid,uuid,uuid,boolean)'::regprocedure);
 needle:='sale_method=''direct_purchase'' and approval_mode=''fixed''';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PURCHASE'; end if;
 d:=replace(d,needle,'sale_method in (''direct_purchase'',''staff_decides'') and approval_mode=''fixed''');
 needle:='select * into prior from komisio_private.central_direct_purchases';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PURCHASE_LOCK'; end if;
 execute replace(d,needle,'if komisio_private.resolved_central_sale_method(r.id,r.sale_method)=''consignment'' then raise exception ''REQUEST_CHANGED''; end if;
 '||needle);
 d:=pg_get_functiondef('komisio_private.external_request_state(uuid,timestamptz)'::regprocedure);
 needle:='when r.sale_method=''direct_purchase'' and exists';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PURCHASE_STATE'; end if;
 execute replace(d,needle,'when r.sale_method in (''direct_purchase'',''staff_decides'') and exists');
 foreach sig in array array['public.my_external_item_requests_page(integer,uuid,text)','public.central_request_queue(uuid,integer,text,text,uuid)'] loop
  d:=pg_get_functiondef(sig::regprocedure); needle:='r.sale_method,';
  if position(needle in d)=0 then raise exception 'UNEXPECTED_REQUEST_READ'; end if;
  execute replace(d,needle,'(r.sale_method=''staff_decides'') as staff_selects_method,komisio_private.resolved_central_sale_method(r.id,r.sale_method) as sale_method,');
 end loop;
 d:=pg_get_functiondef('public.read_external_item_offer(uuid)'::regprocedure);
 needle:='''saleMethod'',(select r.sale_method from public.external_item_requests r where r.id=offer.request_id)';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_OFFER_READ'; end if;
 execute replace(d,needle,'''staffSelectsMethod'',(select r.sale_method=''staff_decides'' from public.external_item_requests r where r.id=offer.request_id),
  ''saleMethod'',(select komisio_private.resolved_central_sale_method(r.id,r.sale_method) from public.external_item_requests r where r.id=offer.request_id)');
 -- Use precisely the same immutable guarantee, agreement, ledger and due-date
 -- inputs as normal receipt. A grouped handover must only change the chosen item.
 d:=pg_get_functiondef('komisio_private.ensure_external_item_guarantees(uuid,uuid)'::regprocedure);
 needle:='p_handover uuid)';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_RECEIPT_SIGNATURE'; end if;
 d:=replace(d,needle,'p_handover uuid,p_request uuid)');
 needle:='req.id=o.request_id and req.sale_method=''consignment''';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_RECEIPT_SELECTION'; end if;
 execute replace(d,needle,'req.id=o.request_id and req.id=p_request and req.sale_method=''staff_decides''');
end $$;
revoke all on function komisio_private.ensure_external_item_guarantees(uuid,uuid,uuid) from public,anon,authenticated;

create function public.confirm_central_receipt_consignment(p_tenant uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); owner_id uuid; handover uuid; offer uuid; guarantee uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select r.owner_id into owner_id from public.external_item_requests r
 where r.tenant_id=p_tenant and r.id=p_request and r.approval_mode='fixed' and r.sale_method='staff_decides';
 if not found then raise exception 'REQUEST_CHANGED'; end if;
 perform komisio_private.lock_external_owner(owner_id);
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') or
 not exists(select 1 from public.platform_settings where only_row and central_app_tenant_id=p_tenant)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select h.id,o.id into handover,offer from public.external_item_offers o
 join public.external_item_handover_links l on l.offer_id=o.id and l.tenant_id=o.tenant_id
 join public.seller_handovers h on h.id=l.handover_id and h.tenant_id=l.tenant_id
 join public.sellers s on s.id=l.seller_id and s.tenant_id=p_tenant and s.external_owner_id=l.owner_id
 where o.tenant_id=p_tenant and o.request_id=p_request and o.approval_source='fixed_request'
 and h.status='received' and h.received_at is not null and s.privacy_closed_at is null;
 if not found or exists(select 1 from komisio_private.central_direct_purchases where request_id=p_request) then raise exception 'REQUEST_CHANGED'; end if;
 select id into guarantee from public.external_item_guarantees where offer_id=offer;
 if found then return guarantee; end if;
 perform komisio_private.require_writable(p_tenant);
 perform komisio_private.ensure_external_item_guarantees(p_tenant,handover,p_request);
 select id into strict guarantee from public.external_item_guarantees where offer_id=offer;
 perform komisio_private.record_access(p_tenant,'central_item.consignment_selected',p_request,jsonb_build_object('guaranteeId',guarantee));
 return guarantee;
end $$;
revoke all on function public.confirm_central_receipt_consignment(uuid,uuid) from public,anon;
grant execute on function public.confirm_central_receipt_consignment(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
