-- P3 price evidence: comparable sales in the store itself. What the store
-- accepted and what it later sold for, per category and free text, from
-- the store's own facts; no external data, no cross-store comparison, no
-- suggestion. The read is what staff and the reception agent cite as price
-- evidence; it is evidence, never a price.
create function komisio_private.item_title(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.items; title text; category text;
begin
 select * into item from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return jsonb_build_object('title',null,'category',null); end if;
 if item.origin_kind='inspection_draft' then
  select description,d.category into title,category from public.inspection_draft_revisions d where d.tenant_id=p_tenant and d.draft_id=item.origin_id and d.revision=item.origin_revision;
 elsif item.origin_kind='reception_review' then
  select suggestions->'metadata'->'description'->>'value',suggestions->'metadata'->'category'->>'value' into title,category from public.reception_reviews where tenant_id=p_tenant and session_id=item.origin_id and version=item.origin_revision;
 else
  select supplier_note into title from public.purchase_receipts where tenant_id=p_tenant and id=item.origin_id;
 end if;
 return jsonb_build_object('title',nullif(trim(coalesce(title,'')),''),'category',nullif(trim(coalesce(category,'')),''));
end $$;
revoke all on function komisio_private.item_title(uuid,uuid) from public,anon,authenticated;

create function public.price_evidence(p_tenant uuid,p_category text,p_query text,p_days integer default 365) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cat text:=nullif(trim(coalesce(p_category,'')),''); q text:=nullif(trim(coalesce(p_query,'')),''); matches jsonb; summary jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_days is null or p_days<1 or p_days>1095 or length(coalesce(cat,''))>120 or length(coalesce(q,''))>120 then raise exception 'INVALID_INPUT'; end if;
 with sold as (
  select i.id as item_id, i.accepted_at, s.occurred_at as sold_at, l.price_ore as sold_ore,
   (select price_ore from public.item_prices p where p.tenant_id=p_tenant and p.item_id=i.id order by p.set_at,p.seq limit 1) as accepted_ore,
   (select count(*) from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind='markdown_applied') as markdowns,
   komisio_private.item_title(p_tenant,i.id) as facts
  from public.sale_lines l
  join public.sales s on s.tenant_id=l.tenant_id and s.id=l.sale_id
  join public.items i on i.tenant_id=l.tenant_id and i.id=l.item_id
  where l.tenant_id=p_tenant and s.status='completed' and s.occurred_at>=now()-make_interval(days=>p_days)
   and not exists(select 1 from public.sale_returns r where r.tenant_id=l.tenant_id and r.sale_line_id=l.id)
 ), filtered as (
  select * from sold
  where (cat is null or lower(facts->>'category')=lower(cat))
   and (q is null or facts->>'title' ilike '%'||replace(replace(q,'%','\%'),'_','\_')||'%')
 )
 select
  (select coalesce(jsonb_agg(jsonb_build_object('itemId',f.item_id,'title',f.facts->>'title','category',f.facts->>'category','acceptedPriceOre',f.accepted_ore,'soldPriceOre',f.sold_ore,
    'markdowns',f.markdowns,'acceptedAt',f.accepted_at,'soldAt',f.sold_at,'daysToSale',greatest(0,floor(extract(epoch from (f.sold_at-f.accepted_at))/86400))::int) order by f.sold_at desc),'[]'::jsonb)
   from (select * from filtered order by sold_at desc limit 20) f),
  (select jsonb_build_object('count',count(*),'medianSoldOre',(percentile_cont(0.5) within group (order by sold_ore))::bigint,'minSoldOre',min(sold_ore),'maxSoldOre',max(sold_ore),
    'averageDaysToSale',round(avg(greatest(0,extract(epoch from (sold_at-accepted_at))/86400)))::int) from filtered)
 into matches, summary;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'days',p_days,'category',cat,'query',q,'summary',summary,'matches',matches);
end $$;
revoke all on function public.price_evidence(uuid,text,text,integer) from public,anon;
grant execute on function public.price_evidence(uuid,text,text,integer) to authenticated;
