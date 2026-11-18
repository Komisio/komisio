-- Staff detail distinguishes missing accounting from a calculated zero.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.sale_detail(uuid,uuid)'::regprocedure);
 if position('x.vat_rate_bp,x.vat_ore' in d)=0 then raise exception 'UNEXPECTED_SALE_DETAIL'; end if;
 execute replace(d,'x.vat_rate_bp,x.vat_ore','x.vat_rate_bp,x.vat_ore,x.accounting_pending,(x.vat_basis->>''fixedAmountOre'')::bigint as guaranteed_amount_ore');
end $$;

-- POS product publication still needs a decided VAT mapping. Recording an
-- actual sale is now supported; that does not authorize guessing export VAT.
do $$ declare d text; signature text; needle text; begin
 foreach signature in array array['public.prepare_zettle_product_before_pos_import(uuid,uuid)','komisio_private.paypal_item_snapshot(uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:='mode:=komisio_private.sale_line_facts';
  if position(needle in d)=0 then raise exception 'UNEXPECTED_POS_VAT_READ'; end if;
  execute replace(d,needle,'if exists(select 1 from public.items where tenant_id=p_tenant and id=p_item and terms ? ''externalGuarantee'')
   then raise exception ''GUARANTEED_SALE_REQUIRED''; end if; '||needle);
 end loop;
end $$;

-- Retain the existing installation/notification protocol. Central sellers
-- are linked by their explicit Auth ID, never by a contact email match.
create function komisio_private.enqueue_central_item_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.items; g public.external_item_guarantees; pol public.store_policy_versions; event_id uuid; event_kind text;
begin
 if tg_table_name='items' then i:=new; event_id:=i.id; event_kind:='item_registered';
 else
  select * into i from public.items where tenant_id=new.tenant_id and id=new.item_id;
  event_id:=new.id; event_kind:='item_sold';
  if exists(select 1 from public.sale_returns where tenant_id=new.tenant_id and sale_line_id=new.id) then return new; end if;
 end if;
 if not(i.terms ? 'externalGuarantee') then return new; end if;
 select * into g from public.external_item_guarantees where tenant_id=i.tenant_id and id::text=i.terms#>>'{externalGuarantee,id}';
 if g.id is null or not exists(select 1 from public.platform_settings where central_app_tenant_id=g.tenant_id) then return new; end if;
 select * into pol from public.store_policy_versions where tenant_id=i.tenant_id order by version desc limit 1;
 if pol.policy->>(case when event_kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end) is distinct from 'true' then return new; end if;
 insert into komisio_private.seller_push_deliveries(tenant_id,seller_id,item_id,device_id,device_generation,policy_version,kind,reference_id)
 select g.tenant_id,g.seller_id,i.id,d.id,d.generation,pol.version,event_kind,event_id
 from komisio_private.seller_push_devices d join public.sellers s on s.tenant_id=g.tenant_id and s.id=g.seller_id and s.external_owner_id=d.user_id
 where d.user_id=g.owner_id and s.privacy_closed_at is null and d.enabled and komisio_private.external_push_session_valid(d.user_id,d.session_id)
 on conflict(device_id,device_generation,kind,reference_id) do nothing;
 return new;
end $$;
-- Ordinary-store triggers remain unchanged. Only guarantee rows enqueue this trigger.
create constraint trigger central_push_registered after insert on public.items deferrable initially deferred
 for each row when (new.terms ? 'externalGuarantee') execute function komisio_private.enqueue_central_item_push();
create constraint trigger central_push_sold after insert on public.sale_lines deferrable initially deferred
 for each row when (new.guarantee_id is not null) execute function komisio_private.enqueue_central_item_push();
alter function komisio_private.seller_push_eligible(uuid) rename to seller_push_eligible_before_guarantees;
create function komisio_private.seller_push_eligible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select komisio_private.seller_push_eligible_before_guarantees(p_id) or exists(
  select 1 from komisio_private.seller_push_deliveries q
  join public.items i on i.tenant_id=q.tenant_id and i.id=q.item_id
  join public.external_item_guarantees g on g.tenant_id=i.tenant_id and g.id::text=i.terms#>>'{externalGuarantee,id}'
  join public.sellers s on s.tenant_id=g.tenant_id and s.id=g.seller_id and s.id=q.seller_id
  join komisio_private.seller_push_devices d on d.id=q.device_id and d.generation=q.device_generation and d.user_id=g.owner_id and d.user_id=s.external_owner_id
  join public.platform_settings c on c.central_app_tenant_id=g.tenant_id
  join lateral(select * from public.store_policy_versions where tenant_id=g.tenant_id order by version desc limit 1) p on true
  where q.id=p_id and q.request_id is null and q.owner_id is null and s.privacy_closed_at is null and d.enabled
   and komisio_private.external_push_session_valid(d.user_id,d.session_id)
   and p.policy->>(case when q.kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end)='true'
   and not exists(select 1 from public.store_policy_versions disabled where disabled.tenant_id=q.tenant_id and disabled.version>q.policy_version
    and disabled.policy->>(case when q.kind='item_registered' then 'pushItemRegistered' else 'pushItemSold' end) is distinct from 'true')
   and (q.kind='item_registered' and q.reference_id=i.id or q.kind='item_sold' and exists(select 1 from public.sale_lines l join public.sales sale on sale.tenant_id=l.tenant_id and sale.id=l.sale_id
    where l.tenant_id=q.tenant_id and l.id=q.reference_id and l.item_id=q.item_id and sale.status='completed'
     and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id))))
$$;
revoke all on function komisio_private.enqueue_central_item_push(),komisio_private.seller_push_eligible(uuid),komisio_private.seller_push_eligible_before_guarantees(uuid) from public,anon,authenticated;
