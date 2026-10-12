-- Fresh classifications supplement immutable legacy receipt facts.
create table public.zettle_receipt_classifications (
 import_id uuid primary key, tenant_id uuid not null,
 kind text not null check(kind in ('sale','refund')),
 original_external_id uuid,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,import_id) references public.zettle_imports(tenant_id,id),
 check((kind='refund')=(original_external_id is not null))
);
create index zettle_refund_original on public.zettle_receipt_classifications(tenant_id,original_external_id) where kind='refund';
alter table public.zettle_receipt_classifications enable row level security;
revoke all on public.zettle_receipt_classifications from public,anon,authenticated;
grant select on public.zettle_receipt_classifications to authenticated;
create policy receipt_classification_read on public.zettle_receipt_classifications for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin','staff','readonly'));
create trigger receipt_classification_immutable before update or delete on public.zettle_receipt_classifications for each row execute function komisio_private.preserve_correction();
alter table public.zettle_receipt_outcomes add column return_ids uuid[] check(return_ids is null or cardinality(return_ids) between 1 and 50);

create function komisio_private.reconcile_zettle_refund(p_tenant uuid,p_import uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=komisio_private.require_identity(); receipt public.zettle_imports; classification public.zettle_receipt_classifications;
 sale public.sales; last public.zettle_receipt_outcomes; line jsonb; matches uuid[]; match_id uuid;
 ids uuid[]:=array[]::uuid[]; sale_lines uuid[]:=array[]::uuid[]; failure text; total numeric:=0; position integer:=0;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 select * into receipt from public.zettle_imports where tenant_id=p_tenant and id=p_import;
 select * into classification from public.zettle_receipt_classifications where tenant_id=p_tenant and import_id=p_import and kind='refund';
 if classification.import_id is null then raise exception 'ZETTLE_UNSUPPORTED_PURCHASE';end if;
 select * into last from public.zettle_receipt_outcomes where tenant_id=p_tenant and import_id=p_import order by created_at desc,id desc limit 1;
 if last.return_ids is not null then return;end if;
 begin
  select * into sale from public.sales where tenant_id=p_tenant and provider='zettle' and external_id=classification.original_external_id::text and status='completed';
  if sale.id is null then raise exception 'ZETTLE_ORIGINAL_SALE_REQUIRED';end if;
  if sale.currency is distinct from receipt.currency then raise exception 'CURRENCY_MISMATCH';end if;
  if receipt.amount_ore>=0 or receipt.occurred_at<sale.occurred_at then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
  for line in select * from jsonb_array_elements(receipt.lines) loop
   select array_agg(distinct sl.id) into matches from public.zettle_product_exports e
   join public.sale_lines sl on sl.tenant_id=e.tenant_id and sl.item_id=e.item_id and sl.sale_id=sale.id
   where e.tenant_id=p_tenant and e.product_id=(line->>'productUuid')::uuid and e.variant_id=(line->>'variantUuid')::uuid;
   if cardinality(matches) is distinct from 1 or (line->>'labelConflict')::boolean then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
   match_id:=matches[1];
   if match_id=any(sale_lines) then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
   if (select price_ore from public.sale_lines where tenant_id=p_tenant and id=match_id) is distinct from (line->>'priceOre')::bigint then raise exception 'PARTIAL_REFUND_UNSUPPORTED';end if;
   sale_lines:=array_append(sale_lines,match_id);
   total:=total+(line->>'priceOre')::numeric;
  end loop;
  if total<>-receipt.amount_ore or total<=0 then raise exception 'ZETTLE_REFUND_MISMATCH';end if;
  for line in select * from jsonb_array_elements(receipt.lines) loop
   position:=position+1;
   ids:=array_append(ids,komisio_private.record_return_core(p_tenant,gen_random_uuid(),sale_lines[position],(line->>'priceOre')::bigint,'PayPal POS refund',receipt.occurred_at));
  end loop;
 exception when others then
  ids:=null;
  failure:=case when sqlerrm in ('ZETTLE_ORIGINAL_SALE_REQUIRED','ZETTLE_REFUND_MISMATCH','CURRENCY_MISMATCH','PARTIAL_REFUND_UNSUPPORTED','LINE_ALREADY_RETURNED','INVALID_INPUT') then sqlerrm else 'ZETTLE_RETURN_FAILED' end;
 end;
 if last.id is not null and last.error_code is not distinct from failure and last.return_ids is not distinct from ids then return;end if;
 insert into public.zettle_receipt_outcomes(tenant_id,import_id,mapping_revision,sale_id,error_code,return_ids,created_by)
 values(p_tenant,p_import,0,null,failure,ids,actor);
end $$;
revoke all on function komisio_private.reconcile_zettle_refund(uuid,uuid) from public,anon,authenticated;

create function public.zettle_return_status(p_tenant uuid,p_imports uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_imports is null or cardinality(p_imports)>50 then raise exception 'INVALID_INPUT';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('importId',c.import_id,'kind',c.kind,'originalExternalId',c.original_external_id,'originalSaleId',s.id,'returnIds',o.return_ids,'errorCode',o.error_code))
  from public.zettle_receipt_classifications c
  left join public.sales s on s.tenant_id=c.tenant_id and s.provider='zettle' and s.external_id=c.original_external_id::text
  left join lateral(select oo.return_ids,oo.error_code from public.zettle_receipt_outcomes oo where oo.tenant_id=c.tenant_id and oo.import_id=c.import_id order by oo.created_at desc,oo.id desc limit 1) o on true
  where c.tenant_id=p_tenant and c.import_id=any(p_imports)),'[]'::jsonb);
end $$;
revoke all on function public.zettle_return_status(uuid,uuid[]) from public,anon;
grant execute on function public.zettle_return_status(uuid,uuid[]) to authenticated;
