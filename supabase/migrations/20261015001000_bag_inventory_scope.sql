-- Handover scope shares the inventory projection, before counting and paging.
create or replace function public.items_search_page(p_tenant uuid,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb:=coalesce(p_filters,'{}'); k text; v text; rows jsonb; total integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(f)<>'object' or p_sort is null or p_sort not in ('title','category','seller','price','stage','accepted','periodEnd')
  or p_direction is null or p_direction not in ('asc','desc') or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'INVALID_INPUT'; end if;
 for k,v in select key,value from jsonb_each_text(f) loop
  if k not in ('bag','q','stage','ownership','seller','category','itemType','assortment','minPrice','maxPrice','acceptedFrom','acceptedTo','endsBefore','photo','origin','paypal','syncProvider','syncStatus')
   or jsonb_typeof(f->k)<>'string' or v is null or length(v)>120 then raise exception 'INVALID_INPUT'; end if;
  if v='' then f:=f-k; end if;
 end loop;
 if f->>'syncProvider' not in ('paypal','shopify') or f->>'syncStatus' not in ('not_sent','changed','failed','attention','synced','inactive','linked') or f->>'stage' not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold')
  or f->>'ownership' not in ('consignment','store') or f->>'photo' not in ('yes','no')
  or f->>'paypal' not in ('not_sent','changed','failed','attention','synced','inactive') or f->>'origin' not in ('inspection_draft','reception_review','purchase') then raise exception 'INVALID_INPUT'; end if;
 foreach k in array array['minPrice','maxPrice'] loop
  if f ? k and f->>k !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' then raise exception 'INVALID_INPUT'; end if;
 end loop;
 foreach k in array array['acceptedFrom','acceptedTo','endsBefore'] loop
  if f ? k then
   if f->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
   begin perform (f->>k)::date; exception when others then raise exception 'INVALID_INPUT'; end;
  end if;
 end loop;
 if (f->>'minPrice')::numeric>(f->>'maxPrice')::numeric or f->>'acceptedFrom'>f->>'acceptedTo' then raise exception 'INVALID_INPUT'; end if;
 if f ? 'bag' then
  begin perform (f->>'bag')::uuid; exception when invalid_text_representation then raise exception 'INVALID_INPUT'; end;
  if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=(f->>'bag')::uuid) then raise exception 'BAG_NOT_FOUND'; end if;
 end if;
 with facts as materialized (
  select i.id,i.origin_kind,i.seller_id,i.ownership,i.accepted_at,s.name as seller,
   c.value as classification,t.value->>'title' as title,t.value->>'category' as category,l.value as lifecycle,
   case when f ? 'bag' and l.value->>'stage'='sold' then
    (select sl.price_ore from public.sale_lines sl join public.sales sa on sa.tenant_id=sl.tenant_id and sa.id=sl.sale_id
     where sl.tenant_id=p_tenant and sl.item_id=i.id and sa.status='completed'
      and not exists(select 1 from public.sale_returns sr where sr.tenant_id=sl.tenant_id and sr.sale_line_id=sl.id)
     order by sa.occurred_at desc limit 1)
    else (l.value->>'currentPriceOre')::bigint end as price,(l.value->>'periodEnd')::timestamptz as period_end,
   ps.value as paypal,sync.value as sync,l.value->>'stage' as stage,m.value->>'defaultPhotoId' as photo_id,jsonb_array_length(m.value->'photos') as photo_count
  from public.items i
  left join public.sellers s on s.tenant_id=i.tenant_id and s.id=i.seller_id
  cross join lateral (select komisio_private.item_title(p_tenant,i.id) value) t
  cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) value) l
  cross join lateral (select komisio_private.item_photo_snapshot(p_tenant,i.id) value) m
  cross join lateral (select komisio_private.paypal_item_snapshot(p_tenant,i.id) value) ps
  cross join lateral (select komisio_private.item_sync_snapshot(p_tenant,i.id) value) sync
  cross join lateral (select komisio_private.item_classification(p_tenant,i.id) value) c
  where i.tenant_id=p_tenant
   and (not f ? 'bag' or
    (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions rs where rs.tenant_id=p_tenant and rs.id=i.origin_id and rs.bag_id=(f->>'bag')::uuid)) or
    (i.origin_kind='inspection_draft' and exists(select 1 from public.inspection_draft_revisions dr where dr.tenant_id=p_tenant and dr.draft_id=i.origin_id and dr.bag_id=(f->>'bag')::uuid)))
   and (not f ? 'ownership' or i.ownership=f->>'ownership')
   and (not f ? 'origin' or i.origin_kind=f->>'origin')
   and (not f ? 'seller' or strpos(lower(coalesce(s.name,'')),lower(f->>'seller'))>0 or i.seller_id::text=f->>'seller')
   and (not f ? 'acceptedFrom' or i.accepted_at>=((f->>'acceptedFrom')::date::timestamp at time zone 'Europe/Stockholm'))
   and (not f ? 'acceptedTo' or i.accepted_at<(((f->>'acceptedTo')::date+1)::timestamp at time zone 'Europe/Stockholm'))
 ), matches as materialized (
  select * from facts where
   (not f ? 'q' or strpos(lower(coalesce(title,'')||' '||coalesce(category,'')),lower(f->>'q'))>0 or id::text=f->>'q')
   and (not (f ? 'syncProvider' or f ? 'syncStatus') or exists(select 1 from jsonb_array_elements(sync) connection where (not f ? 'syncProvider' or connection->>'provider'=f->>'syncProvider') and (not f ? 'syncStatus' or connection->>'status'=f->>'syncStatus')))
   and (not f ? 'paypal' or paypal->>'status'=f->>'paypal')
   and (not f ? 'itemType' or classification->>'itemType'=f->>'itemType')
   and (not f ? 'assortment' or classification->>'assortment'=f->>'assortment')
   and (not f ? 'category' or strpos(lower(coalesce(category,'')),lower(f->>'category'))>0)
   and (not f ? 'stage' or stage=f->>'stage')
   and (not f ? 'minPrice' or price>=(f->>'minPrice')::numeric*100)
   and (not f ? 'maxPrice' or price<=(f->>'maxPrice')::numeric*100)
   and (not f ? 'endsBefore' or period_end<(((f->>'endsBefore')::date+1)::timestamp at time zone 'Europe/Stockholm'))
   and (not f ? 'photo' or (photo_id is not null)=(f->>'photo'='yes'))
 ), ordered as (
  select *,row_number() over(order by
   case when p_direction='asc' then case p_sort when 'title' then lower(title) when 'category' then lower(category) when 'seller' then lower(seller) when 'stage' then stage end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'title' then lower(title) when 'category' then lower(category) when 'seller' then lower(seller) when 'stage' then stage end end desc nulls last,
   case when p_sort='price' and p_direction='asc' then price end asc nulls last,
   case when p_sort='price' and p_direction='desc' then price end desc nulls last,
   case when p_direction='asc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end asc nulls last,
   case when p_direction='desc' then case p_sort when 'accepted' then accepted_at when 'periodEnd' then period_end end end desc nulls last,id) as position
  from matches
 ), page as (select * from ordered order by position limit p_limit offset p_offset)
 select (select count(*)::int from matches),coalesce(jsonb_agg(jsonb_build_object(
  'classification',p.classification,'sync',p.sync,'paypal',p.paypal,'id',p.id,'title',p.title,'category',p.category,'sellerId',p.seller_id,'sellerName',p.seller,'ownership',p.ownership,
  'originKind',p.origin_kind,'acceptedAt',p.accepted_at,'periodEnd',p.period_end,'currentPriceOre',p.price,'stage',p.stage,
  'defaultPhotoId',p.photo_id,'photoCount',p.photo_count,'nextMarkdownAt',n.value->>'at','nextMarkdownPercent',n.value->'percent'
 ) order by p.position),'[]') into total,rows
 from page p cross join lateral (select komisio_private.next_markdown(p.lifecycle) value) n;
 return jsonb_build_object('currency',komisio_private.store_currency(p_tenant),'items',rows,'total',total,'limit',p_limit,'offset',p_offset);
end $$;
