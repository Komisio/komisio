-- Read only: expose names solely for actors already recorded on the authorized item.
create or replace function public.item_detail(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare it public.items;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into it from public.items where tenant_id=p_tenant and id=p_item;
 if not found then return null; end if;
 return jsonb_build_object(
  'item',jsonb_build_object('id',it.id,'origin_kind',it.origin_kind,'origin_id',it.origin_id,'origin_revision',it.origin_revision,
   'custody_kind',it.custody_kind,'custody_id',it.custody_id,'seller_id',it.seller_id,'ownership',it.ownership,'terms',it.terms,'accepted_at',it.accepted_at,'actor',jsonb_build_object('id',it.accepted_by,'name',(select nullif(btrim(u.display_name),'') from public.user_profiles u where u.user_id=it.accepted_by))),
  'prices',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'price_ore',p.price_ore,'reason',p.reason,'set_at',p.set_at,'actor',jsonb_build_object('id',p.set_by,'name',(select nullif(btrim(u.display_name),'') from public.user_profiles u where u.user_id=p.set_by))) order by p.set_at desc,p.seq desc)
   from public.item_prices p where p.tenant_id=p_tenant and p.item_id=p_item),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'detail',e.detail,'occurred_at',e.occurred_at,'actor',jsonb_build_object('id',e.actor,'name',(select nullif(btrim(u.display_name),'') from public.user_profiles u where u.user_id=e.actor))) order by e.occurred_at)
   from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item),'[]'::jsonb));
end $$;

