create or replace function public.zettle_item_image_url(p_tenant uuid,p_item uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return (select upload_row.image_url from public.zettle_image_intents intent_row join public.zettle_image_uploads upload_row on upload_row.tenant_id=intent_row.tenant_id and upload_row.intent_id=intent_row.id where intent_row.tenant_id=p_tenant and intent_row.item_id=p_item);
end $$;
create or replace function public.zettle_image_status(p_tenant uuid) returns table(item_id uuid,status text)
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return query select intent_row.item_id,case when outcome_row.intent_id is not null then 'synced' when upload_row.intent_id is not null then 'uploaded' else 'held' end
 from public.zettle_image_intents intent_row
 left join public.zettle_image_uploads upload_row on upload_row.tenant_id=intent_row.tenant_id and upload_row.intent_id=intent_row.id
 left join public.zettle_image_outcomes outcome_row on outcome_row.tenant_id=intent_row.tenant_id and outcome_row.intent_id=intent_row.id
 where intent_row.tenant_id=p_tenant order by intent_row.created_at desc,intent_row.id limit 50;
end $$;
create function public.zettle_image_status_v2(p_tenant uuid) returns table(item_id uuid,status text)
language sql security invoker set search_path='' as $$
 select * from public.zettle_image_status(p_tenant);
$$;
revoke all on function public.zettle_image_status_v2(uuid) from public,anon;
grant execute on function public.zettle_image_status_v2(uuid) to authenticated;
