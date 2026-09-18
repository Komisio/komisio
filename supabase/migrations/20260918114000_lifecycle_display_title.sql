-- Read-only display projection: keep the lifecycle contract, add origin titles.
create or replace function public.lifecycle_queue_display(p_tenant uuid,p_stage text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('title',komisio_private.item_title(p_tenant,q.item_id)->>'title') order by q.accepted_at,q.item_id),'[]'::jsonb) from public.lifecycle_queue(p_tenant,p_stage) q);
end $$;
revoke all on function public.lifecycle_queue_display(uuid,text) from public,anon;
grant execute on function public.lifecycle_queue_display(uuid,text) to authenticated;
