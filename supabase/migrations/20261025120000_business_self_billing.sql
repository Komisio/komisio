-- #626: supplier VAT is extracted from gross seller credit, never retail VAT.
-- Existing rows are not backfilled; their historical tax facts stay untouched.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)'::regprocedure);
 needle:='  vat:=komisio_private.vat_for_line(mode,p_price_ore,credit,null,vat_rate_bp);';
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_SALE_FACTS'; end if;
 definition:=replace(definition,needle,$patch$
  if seller.seller_type='business' then
   vat_basis:=vat_basis||jsonb_build_object('supplierVat',jsonb_build_object(
    'grossOre',credit,
    'netOre',credit-case when seller_taxable and mode='consignment_business' then round(credit::numeric*vat_rate_bp/(10000+vat_rate_bp))::bigint else 0 end,
    'vatOre',case when seller_taxable and mode='consignment_business' then round(credit::numeric*vat_rate_bp/(10000+vat_rate_bp))::bigint else 0 end,
    'rateBp',case when seller_taxable and mode='consignment_business' then vat_rate_bp else null end,
    'mode',mode,'vatNumber',coalesce(seller.profile->'business'->>'vatNumber','')));
  end if;
  vat:=komisio_private.vat_for_line(mode,p_price_ore,credit,null,vat_rate_bp);
 $patch$);
 execute definition;
end $$;

alter table public.settlement_statements add column self_billing jsonb
 check(self_billing is null or jsonb_typeof(self_billing)='object');

-- The snapshot is computed in the authorized, tenant-locked issue transaction.
-- It is not inferred at read time from mutable profiles or current VAT policy.
create function komisio_private.statement_self_billing() returns trigger
language plpgsql security definer set search_path='' as $$
declare seller public.sellers; original jsonb; details jsonb; rows jsonb:='[]'; entry record; tax jsonb; sign integer; buyer jsonb;
begin
 if tg_op='UPDATE' then
  if new.self_billing is distinct from old.self_billing then raise exception 'IMMUTABLE_STATEMENT' using errcode='55000'; end if;
  return new;
 end if;
 select * into seller from public.sellers where tenant_id=new.tenant_id and id=new.seller_id;
 if seller.seller_type<>'business' then new.self_billing:=null; return new; end if;
 if new.corrects_id is not null then
  select self_billing into original from public.settlement_statements where tenant_id=new.tenant_id and id=new.corrects_id and seller_id=new.seller_id;
  if original is null then raise exception 'SELF_BILLING_FACTS_MISSING'; end if;
  for tax in select value from jsonb_array_elements(original->'lines') loop
   rows:=rows||jsonb_build_array(tax||jsonb_build_object('grossOre',-(tax->>'grossOre')::bigint,'netOre',-(tax->>'netOre')::bigint,'vatOre',-(tax->>'vatOre')::bigint));
  end loop;
  new.self_billing:=original||jsonb_build_object('lines',rows);
  return new;
 end if;
 select jsonb_build_object('name',t.name,'address',coalesce(p.profile->'address','{}'),'contact',coalesce(p.profile->'contact','{}')) into buyer
 from public.tenants t left join lateral (select profile from public.store_profile_versions where tenant_id=t.id order by version desc limit 1) p on true where t.id=new.tenant_id;
 for entry in
  select e.kind,e.reference_id,e.occurred_at,l.id as sale_line_id,l.vat_basis,
   i.description
  from public.seller_ledger_entries e
  left join public.sale_returns r on e.reference_kind='sale_return' and r.tenant_id=e.tenant_id and r.id=e.reference_id
  join public.sale_lines l on l.tenant_id=e.tenant_id and l.id=case when e.reference_kind='sale_line' then e.reference_id else r.sale_line_id end
  join public.items i on i.tenant_id=l.tenant_id and i.id=l.item_id
  where e.tenant_id=new.tenant_id and e.seller_id=new.seller_id and e.kind in ('credit_sale','credit_reversal')
   and e.occurred_at>=new.period_from and e.occurred_at<new.period_to
  order by e.occurred_at,e.id
 loop
  tax:=entry.vat_basis->'supplierVat';
  if tax is null then raise exception 'SELF_BILLING_FACTS_MISSING'; end if;
  sign:=case when entry.kind='credit_reversal' then -1 else 1 end;
  rows:=rows||jsonb_build_array(tax||jsonb_build_object(
   'grossOre',sign*(tax->>'grossOre')::bigint,'netOre',sign*(tax->>'netOre')::bigint,'vatOre',sign*(tax->>'vatOre')::bigint,
   'saleLineId',entry.sale_line_id,'referenceId',entry.reference_id,'kind',entry.kind,'description',entry.description,'occurredAt',entry.occurred_at));
 end loop;
 details:=jsonb_build_object('name',seller.name,'email',seller.email,'phone',seller.phone,
  'addressLine1',coalesce(seller.profile->>'addressLine1',''),'addressLine2',coalesce(seller.profile->>'addressLine2',''),
  'postalCode',coalesce(seller.profile->>'postalCode',''),'city',coalesce(seller.profile->>'city',''),'country',coalesce(seller.profile->>'country',''),
  'business',coalesce(seller.profile->'business','{}'));
 new.self_billing:=jsonb_build_object('version',1,'currency',komisio_private.store_currency(new.tenant_id),'supplier',details,'buyer',buyer,'lines',rows);
 return new;
end $$;
revoke all on function komisio_private.statement_self_billing() from public,anon,authenticated;
create trigger settlement_self_billing before insert or update on public.settlement_statements for each row execute function komisio_private.statement_self_billing();

-- The portal retains the existing ownership/MFA checks and exposes only a label
-- in its list; the authorized detail RPC already returns the frozen header.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.my_seller_economy(uuid,uuid)'::regprocedure);
 if position('select id,number,kind,corrects_id' in definition)=0 then raise exception 'UNEXPECTED_SELLER_ECONOMY'; end if;
 execute replace(definition,'select id,number,kind,corrects_id','select id,number,kind,(self_billing is not null) as is_self_billing,corrects_id');
end $$;
