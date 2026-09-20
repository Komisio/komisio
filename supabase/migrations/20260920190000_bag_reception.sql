alter table public.reception_sessions add column bag_id uuid;
alter table public.reception_sessions add constraint reception_bag_fk foreign key(tenant_id,bag_id) references public.bag_receipts(tenant_id,id);
create index reception_sessions_bag on public.reception_sessions(tenant_id,bag_id,created_at desc,id) where bag_id is not null;

create function public.create_bag_reception(p_tenant uuid,p_id uuid,p_seller uuid,p_bag uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_sessions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_bag is null then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag and seller_id=p_seller) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_sessions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.bag_id is distinct from p_bag or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 insert into public.reception_sessions(id,tenant_id,seller_id,bag_id,created_by) values(p_id,p_tenant,p_seller,p_bag,uid);
 perform komisio_private.record_access(p_tenant,'reception.created',p_id,jsonb_build_object('bagId',p_bag));
 return p_id;
end $$;
revoke all on function public.create_bag_reception(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.create_bag_reception(uuid,uuid,uuid,uuid) to authenticated;

create function public.quick_receive_from_bag(p_tenant uuid,p_request uuid,p_session uuid,p_seller uuid,p_expected integer,p_facts jsonb,p_price_ore bigint,p_bag uuid,p_item_type text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_bag is null or not exists(select 1 from public.reception_sessions where tenant_id=p_tenant and id=p_session and seller_id=p_seller and bag_id=p_bag) then raise exception 'INVALID_INPUT'; end if;
 return public.quick_receive(p_tenant,p_request,p_session,p_seller,p_expected,p_facts,p_price_ore,p_item_type);
end $$;
revoke all on function public.quick_receive_from_bag(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text) from public,anon;
grant execute on function public.quick_receive_from_bag(uuid,uuid,uuid,uuid,integer,jsonb,bigint,uuid,text) to authenticated;

create function public.bag_received_items(p_tenant uuid,p_bag uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select i.id, s.id as session_id, komisio_private.item_title(p_tenant,i.id)->>'title' as title,
   (select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=i.id order by seq desc limit 1) as price_ore,
   (select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=s.id and e->>'kind'='photo' order by r.revision desc limit 1) as photo_id
  from public.items i join public.reception_sessions s on s.tenant_id=i.tenant_id and s.id=i.origin_id
  where s.tenant_id=p_tenant and s.bag_id=p_bag and i.origin_kind='reception_review'
  order by i.accepted_at desc,i.id limit 50
 ) x),'[]'::jsonb);
end $$;
revoke all on function public.bag_received_items(uuid,uuid) from public,anon;
grant execute on function public.bag_received_items(uuid,uuid) to authenticated;
