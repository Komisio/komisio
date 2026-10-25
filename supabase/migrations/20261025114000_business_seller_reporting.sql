-- Seller type is a reporting dimension, not a new accounting key. Historical
-- lines without an explicit snapshot belong to private sellers.
create function komisio_private.seller_type_totals(p_tenant uuid,p_from date,p_to date) returns jsonb
language sql stable security definer set search_path='' as $$
 with facts as (
  select coalesce(l.vat_basis->>'sellerType','private') kind,l.price_ore gross,l.vat_ore vat,
   l.seller_credit_ore credit,0::bigint refunds,0::bigint reversed,0::bigint paid
  from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  where l.tenant_id=p_tenant and l.ownership='consignment' and s.status='completed'
   and s.occurred_at>=p_from::timestamp at time zone 'Europe/Stockholm'
   and s.occurred_at<(p_to+1)::timestamp at time zone 'Europe/Stockholm'
  union all
  select coalesce(l.vat_basis->>'sellerType','private'),0,0,0,r.refund_ore,l.seller_credit_ore,0
  from public.sale_returns r join public.sale_lines l on l.tenant_id=r.tenant_id and l.id=r.sale_line_id
  where r.tenant_id=p_tenant and l.ownership='consignment'
   and r.occurred_at>=p_from::timestamp at time zone 'Europe/Stockholm'
   and r.occurred_at<(p_to+1)::timestamp at time zone 'Europe/Stockholm'
  union all
  select s.seller_type,0,0,0,0,0,p.amount_ore
  from public.payouts p join public.sellers s on s.tenant_id=p.tenant_id and s.id=p.seller_id
  where p.tenant_id=p_tenant and p.status='paid'
   and p.paid_at>=p_from::timestamp at time zone 'Europe/Stockholm'
   and p.paid_at<(p_to+1)::timestamp at time zone 'Europe/Stockholm'
 ), totals as (
  select kind,jsonb_build_object('grossOre',sum(gross),'vatOre',sum(vat),'sellerCreditOre',sum(credit),
   'refundsOre',sum(refunds),'creditReversedOre',sum(reversed),'payoutsPaidOre',sum(paid)) body from facts group by kind
 ) select coalesce(jsonb_object_agg(kind,body),'{}') from totals
$$;
revoke all on function komisio_private.seller_type_totals(uuid,date,date) from public,anon,authenticated;
alter table public.day_closes add column seller_totals jsonb
 check(seller_totals is null or jsonb_typeof(seller_totals)='object');
do $$ declare definition text; begin
 execute replace(pg_get_functiondef('public.economy_summary(uuid,date,date)'::regprocedure),
  'FUNCTION public.economy_summary(', 'FUNCTION komisio_private.economy_summary_before_seller_types(');
 definition:=pg_get_functiondef('public.generate_day_close(uuid,uuid,date)'::regprocedure);
 if position('generated_by,payment_totals,payout_sources)' in definition)=0 or position('uid,totals->''paymentTotals'',komisio_private.paid_payout_sources' in definition)=0 then raise exception 'UNEXPECTED_TYPE_CLOSE'; end if;
 definition:=replace(definition,'if same and ', 'if same and latest.seller_totals is not distinct from komisio_private.seller_type_totals(p_tenant,p_date,p_date) and ');
 definition:=replace(definition,'generated_by,payment_totals,payout_sources)', 'generated_by,seller_totals,payment_totals,payout_sources)');
 definition:=replace(definition,'uid,totals->''paymentTotals'',komisio_private.paid_payout_sources', 'uid,komisio_private.seller_type_totals(p_tenant,p_date,p_date),totals->''paymentTotals'',komisio_private.paid_payout_sources');
 execute definition;
 definition:=pg_get_functiondef('public.day_close_page(uuid)'::regprocedure);
 if position('d.per_mode,d.generated_at' in definition)=0 then raise exception 'UNEXPECTED_TYPE_CLOSE_READ'; end if;
 execute replace(definition,'d.per_mode,d.generated_at','d.per_mode,d.seller_totals,d.generated_at');
end $$;
revoke all on function komisio_private.economy_summary_before_seller_types(uuid,date,date) from public,anon,authenticated;
create or replace function public.economy_summary(p_tenant uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare original jsonb;
begin
 -- The original read enforces identity, role, tenant and bounded dates first.
 original:=komisio_private.economy_summary_before_seller_types(p_tenant,p_from,p_to);
 return original||jsonb_build_object('sellerTypes',komisio_private.seller_type_totals(p_tenant,p_from,p_to));
end $$;
