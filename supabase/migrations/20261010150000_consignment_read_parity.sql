-- Keep legacy and paginated reads equivalent, including optional calendar facts.
create or replace function public.lifecycle_queue_display(p_tenant uuid,p_stage text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object(
  'title',komisio_private.item_title(p_tenant,q.item_id)->>'title',
  'collection_deadline',komisio_private.item_lifecycle(p_tenant,q.item_id)->>'collectionDeadline',
  'collection_due',coalesce((komisio_private.item_lifecycle(p_tenant,q.item_id)->>'collectionDeadline')::timestamptz<=now(),false)
 ) order by q.accepted_at,q.item_id),'[]'::jsonb) from public.lifecycle_queue(p_tenant,p_stage) q);
end $$;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.my_items(uuid,uuid)'::regprocedure);
 if position('''periodEnd'',x.f->>''periodEnd'',' in definition)=0 then raise exception 'UNEXPECTED_SELLER_ITEMS_DEFINITION'; end if;
 definition:=replace(definition,'''periodEnd'',x.f->>''periodEnd'',',
  '''periodEnd'',x.f->>''periodEnd'',''collectionDeadline'',x.f->>''collectionDeadline'',');
 execute definition;
end $$;
