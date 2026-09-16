-- The bag queue as an engine function (2026-09-16, Opus). Listing the bags a
-- store has received read the table directly, so the one tool built on it was
-- unavailable to a store's own assistant: the connector reaches SQL functions
-- and nothing else. Same rows, same order, same store-role check the
-- row-level policy applied, and the seller name embedded exactly as the
-- application already parses it.
--
-- Twenty-one rows, not twenty: the caller takes twenty and uses the presence
-- of the twenty-first to decide whether a further page exists, which is
-- cheaper than a count. A newer cursor walks forward and the caller reverses
-- the page; the order here is the order the cursor needs.
create function public.bag_queue_page(p_tenant uuid,p_seller uuid,p_reference bigint,p_older bigint,p_newer bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_older is not null and p_newer is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_agg(r.row order by r.sort) from (
   select jsonb_build_object('id',b.id,'seller_id',b.seller_id,'reference',b.reference,
    'note',b.note,'received_at',b.received_at,'sellers',jsonb_build_object('name',s.name)) as row,
    case when p_newer is null then -b.reference else b.reference end as sort
   from public.bag_receipts b join public.sellers s on s.id=b.seller_id and s.tenant_id=b.tenant_id
   where b.tenant_id=p_tenant
    and (p_seller is null or b.seller_id=p_seller)
    and (p_reference is null or b.reference=p_reference)
    and (p_older is null or b.reference<p_older)
    and (p_newer is null or b.reference>p_newer)
   order by 2
   limit 21) r),'[]'::jsonb);
end $$;
revoke all on function public.bag_queue_page(uuid,uuid,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.bag_queue_page(uuid,uuid,bigint,bigint,bigint) to authenticated;
insert into public.connector_functions(function_name,scope,kind) values
 ('bag_queue_page','reception:read','')
 on conflict do nothing;
