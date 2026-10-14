-- Reuse existing correction history, with a compare-before-write editor boundary.
create function public.edit_item_description(p_tenant uuid,p_id uuid,p_item uuid,p_expected text,p_title text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.item_attribute_corrections where id=p_id) then
  if not exists(select 1 from public.items where tenant_id=p_tenant and id=p_item) then raise exception 'ITEM_NOT_FOUND'; end if;
  if coalesce(komisio_private.item_title(p_tenant,p_item)->>'title','') is distinct from p_expected then raise exception 'ITEM_CHANGED'; end if;
 end if;
 return public.correct_item_attribute(p_tenant,p_id,p_item,'description',p_title,'Item description updated');
end $$;
revoke all on function public.edit_item_description(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.edit_item_description(uuid,uuid,uuid,text,text) to authenticated;
