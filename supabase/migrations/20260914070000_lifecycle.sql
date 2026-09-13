-- P2 S20 (lifecycle): the sale period and markdown steps frozen on each item
-- become a derived work list, and three staff operations become events:
-- apply a markdown step, extend the period, end the period (charity or
-- return). Nothing here runs automatically; the queue says what is due and a
-- person (or a staged agent proposal later) acts.
alter table public.item_prices drop constraint item_prices_reason_check;
alter table public.item_prices add constraint item_prices_reason_check check(reason in ('accepted','markdown','manual'));
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance','sold','returned','markdown_applied','period_extended','period_ended'));

-- One item's lifecycle facts: period end (accepted_at + frozen days + extensions), current price, due markdown step, on-sale state.
create function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; period_days integer; extension_days integer; period_end timestamptz; ended boolean; sold boolean; accepted_price bigint; current_price bigint;
 steps jsonb; step jsonb; idx integer:=0; due_step integer; due_percent numeric; applied integer[];
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 period_days:=coalesce((item.terms->>'salePeriodDays')::integer,0);
 select coalesce(sum((detail->>'days')::integer),0) into extension_days from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_extended';
 period_end:=item.accepted_at+make_interval(days=>period_days+extension_days);
 ended:=exists(select 1 from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_ended');
 sold:=exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
  and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id));
 select price_ore into accepted_price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at,id limit 1;
 select price_ore into current_price from public.item_prices where tenant_id=p_tenant and item_id=p_item order by set_at desc,id desc limit 1;
 select coalesce(array_agg((detail->>'step')::integer),'{}') into applied from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='markdown_applied';
 steps:=coalesce(item.terms->'markdownSteps','[]'::jsonb);
 for step in select * from jsonb_array_elements(steps) loop
  idx:=idx+1;
  if due_step is null and not (idx=any(applied)) and item.accepted_at+make_interval(days=>(step->>'afterDays')::integer)<=now() then
   due_step:=idx; due_percent:=(step->>'percent')::numeric;
  end if;
 end loop;
 return jsonb_build_object('itemId',item.id,'sellerId',item.seller_id,'ownership',item.ownership,'acceptedAt',item.accepted_at,'periodEnd',period_end,'periodDays',period_days,'extensionDays',extension_days,
  'ended',ended,'sold',sold,'acceptedPriceOre',accepted_price,'currentPriceOre',current_price,'dueStep',due_step,'duePercent',due_percent,'appliedSteps',to_jsonb(applied),'steps',steps,
  'endOfPeriodAction',item.terms->>'endOfPeriodAction',
  'stage',case when sold then 'sold' when ended then 'ended' when due_step is not null then 'markdown_due' when period_end<=now() then 'period_ended' when period_end<=now()+interval '7 days' then 'period_ending' else 'on_sale' end);
end $$;
revoke all on function komisio_private.item_lifecycle(uuid,uuid) from public,anon,authenticated;

-- The work list: every accepted item with its derived stage, oldest period end first.
create function public.lifecycle_queue(p_tenant uuid,p_stage text default null) returns table(item_id uuid,seller_id uuid,ownership text,stage text,accepted_at timestamptz,period_end timestamptz,current_price_ore bigint,due_step integer,due_percent numeric,end_of_period_action text)
language plpgsql stable security definer set search_path='' as $$
declare item public.items; f jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_stage is not null and p_stage not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold') then raise exception 'INVALID_INPUT'; end if;
 for item in select * from public.items i where i.tenant_id=p_tenant order by i.accepted_at,i.id loop
  f:=komisio_private.item_lifecycle(p_tenant,item.id);
  if p_stage is null or f->>'stage'=p_stage then
   item_id:=item.id; seller_id:=item.seller_id; ownership:=item.ownership; stage:=f->>'stage'; accepted_at:=item.accepted_at; period_end:=(f->>'periodEnd')::timestamptz;
   current_price_ore:=(f->>'currentPriceOre')::bigint; due_step:=(f->>'dueStep')::integer; due_percent:=(f->>'duePercent')::numeric; end_of_period_action:=f->>'endOfPeriodAction';
   return next;
  end if;
 end loop;
end $$;

-- Shared guard for the three operations: staff, item on sale, replay by event id.
create function komisio_private.lifecycle_guard(p_tenant uuid,p_id uuid,p_item uuid,p_kind text,p_detail jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_events; f jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_item is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from p_item or prior.kind is distinct from p_kind or prior.actor is distinct from uid
   or not (prior.detail @> p_detail) then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if (f->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (f->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 return true;
end $$;
revoke all on function komisio_private.lifecycle_guard(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

create function public.apply_markdown(p_tenant uuid,p_id uuid,p_item uuid,p_step integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); f jsonb; percent numeric; new_price bigint;
begin
 if p_step is null or p_step<1 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'markdown_applied',jsonb_build_object('step',p_step)) then return p_id; end if;
 f:=komisio_private.item_lifecycle(p_tenant,p_item);
 if to_jsonb(p_step) <@ (f->'appliedSteps') then raise exception 'MARKDOWN_ALREADY_APPLIED'; end if;
 if (f->>'dueStep')::integer is distinct from p_step then raise exception 'MARKDOWN_NOT_DUE'; end if;
 percent:=(f->>'duePercent')::numeric;
 -- The markdown is a share of the accepted price, never compounded on an earlier markdown.
 new_price:=greatest((f->>'acceptedPriceOre')::bigint-komisio_private.share_ore((f->>'acceptedPriceOre')::bigint,round(percent*100)::integer),1);
 insert into public.item_prices(tenant_id,item_id,price_ore,reason,set_by) values(p_tenant,p_item,new_price,'markdown',uid);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_tenant,p_item,'markdown_applied',jsonb_build_object('step',p_step,'percent',percent,'priceOre',new_price),uid);
 perform komisio_private.record_access(p_tenant,'item.markdown',p_item,jsonb_build_object('step',p_step,'price_ore',new_price));
 return p_id;
end $$;

create function public.extend_sale_period(p_tenant uuid,p_id uuid,p_item uuid,p_days integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_reason,''));
begin
 if p_days is null or p_days<1 or p_days>365 or length(note) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'period_extended',jsonb_build_object('days',p_days,'reason',note)) then return p_id; end if;
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_tenant,p_item,'period_extended',jsonb_build_object('days',p_days,'reason',note),uid);
 perform komisio_private.record_access(p_tenant,'item.period_extended',p_item,jsonb_build_object('days',p_days));
 return p_id;
end $$;

create function public.end_sale_period(p_tenant uuid,p_id uuid,p_item uuid,p_action text,p_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,''));
begin
 if p_action is null or p_action not in ('charity','return') or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 if not komisio_private.lifecycle_guard(p_tenant,p_id,p_item,'period_ended',jsonb_build_object('action',p_action,'note',note)) then return p_id; end if;
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_tenant,p_item,'period_ended',jsonb_build_object('action',p_action,'note',note),uid);
 perform komisio_private.record_access(p_tenant,'item.period_ended',p_item,jsonb_build_object('action',p_action));
 return p_id;
end $$;
revoke all on function public.lifecycle_queue(uuid,text),public.apply_markdown(uuid,uuid,uuid,integer),public.extend_sale_period(uuid,uuid,uuid,integer,text),public.end_sale_period(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.lifecycle_queue(uuid,text),public.apply_markdown(uuid,uuid,uuid,integer),public.extend_sale_period(uuid,uuid,uuid,integer,text),public.end_sale_period(uuid,uuid,uuid,text,text) to authenticated;

-- An ended item is no longer for sale: recording a sale of it fails.
create or replace function komisio_private.sale_line_facts(p_tenant uuid,p_item uuid,p_price_ore bigint,p_policy jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; terms jsonb; basis text; rate numeric; rate_bp integer; commission bigint:=0; commission_vat bigint:=0; credit bigint:=0;
 vat_rate_bp integer; mode text; seller_taxable boolean; margin_attested boolean; vat_basis jsonb; vat bigint;
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if exists(select 1 from public.sale_lines l join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
   where l.tenant_id=p_tenant and l.item_id=p_item and s.status='completed'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)) then raise exception 'ITEM_ALREADY_SOLD'; end if;
 if exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item and e.kind='period_ended') then raise exception 'ITEM_ENDED'; end if;
 terms:=item.terms;
 vat_rate_bp:=round(coalesce((p_policy->>'vatRatePercent')::numeric,25)*100)::integer;
 if item.ownership='consignment' then
  basis:=terms->>'commissionBasis'; rate:=(terms->>'commissionRatePercent')::numeric;
  if basis not in ('inclusive','exclusive') or rate is null then raise exception 'INVALID_INPUT'; end if;
  rate_bp:=round(rate*100)::integer;
  commission:=komisio_private.share_ore(p_price_ore,rate_bp);
  if basis='exclusive' then commission_vat:=komisio_private.commission_invoice_vat(commission,vat_rate_bp); end if;
  credit:=p_price_ore-commission-commission_vat;
  if credit<0 then raise exception 'INVALID_INPUT'; end if;
  seller_taxable:=basis='exclusive';
  if seller_taxable then mode:='consignment_business';
  else
   mode:=p_policy->>'vatModeConsignmentPrivate';
   if mode is null then raise exception 'VAT_MODE_NOT_SET'; end if;
  end if;
  vat_basis:=jsonb_build_object('priceOre',p_price_ore,'sellerCreditOre',credit,'commissionExVatOre',case when seller_taxable then commission else null end);
  vat:=komisio_private.vat_for_line(mode,p_price_ore,credit,null,vat_rate_bp);
 else
  margin_attested:=coalesce((terms->>'marginEligible')::boolean,false);
  mode:=p_policy->>'vatModeStoreOwned';
  if mode is null then raise exception 'VAT_MODE_NOT_SET'; end if;
  if mode='store_margin' and not margin_attested then mode:='store_full'; end if;
  vat_basis:=jsonb_build_object('priceOre',p_price_ore,'purchasePriceOre',(terms->>'purchasePriceOre')::bigint,'marginAttested',margin_attested);
  vat:=komisio_private.vat_for_line(mode,p_price_ore,null,(terms->>'purchasePriceOre')::bigint,vat_rate_bp);
 end if;
 return jsonb_build_object('itemId',item.id,'priceOre',p_price_ore,'ownership',item.ownership,'commissionBasis',basis,'commissionRatePercent',rate,
  'commissionOre',commission,'commissionVatOre',commission_vat,'sellerCreditOre',credit,'sellerId',item.seller_id,
  'vatMode',mode,'vatRateBp',vat_rate_bp,'vatBasis',vat_basis,'vatOre',vat,
  'agreementVersionId',terms->'agreementVersionId','sellerTermsVersion',terms->'sellerTermsVersion','storePolicyVersion',terms->'storePolicyVersion');
end $$;
