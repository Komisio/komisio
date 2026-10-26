-- #636: physical collection evidence is separate from ending a sale period.
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance','sold','returned','markdown_applied','period_extended','period_ended','collection_recorded'));

create function public.record_item_collection(
 p_tenant uuid,p_id uuid,p_item uuid,p_end_event uuid,p_expected_current uuid,
 p_collected boolean,p_observed_on date,p_note text default ''
) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_events;
 ending public.item_events; current_event public.item_events; facts jsonb;
 note text:=trim(coalesce(p_note,'')); input jsonb; event_time timestamptz;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_id is null or p_item is null or p_end_event is null or p_collected is null
  or p_observed_on is null or not isfinite(p_observed_on)
  or p_observed_on>(now() at time zone 'Europe/Stockholm')::date
  or p_observed_on<date '1900-01-01' or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 input:=jsonb_build_object('endEventId',p_end_event,'expectedCurrentId',p_expected_current,
  'collected',p_collected,'observedOn',p_observed_on,'note',note);
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from p_item
   or prior.actor is distinct from uid or prior.kind<>'collection_recorded' or prior.detail is distinct from input
   then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 if not coalesce((facts->>'ended')::boolean,false) or coalesce((facts->>'sold')::boolean,false)
  or facts->>'ownership'<>'consignment' then raise exception 'ITEM_COLLECTION_UNAVAILABLE'; end if;
 select * into ending from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_ended'
  order by occurred_at desc,id desc limit 1;
 if ending.id is distinct from p_end_event or ending.detail->>'action' is distinct from 'return'
  then raise exception 'ITEM_COLLECTION_UNAVAILABLE'; end if;
 select * into current_event from public.item_events where tenant_id=p_tenant and item_id=p_item
  and kind='collection_recorded' and detail->>'endEventId'=p_end_event::text
  order by occurred_at desc,id desc limit 1;
 if current_event.id is distinct from p_expected_current then raise exception 'ITEM_COLLECTION_CHANGED'; end if;
 -- Order successive observations even within one transaction. Old evidence is untouched.
 select greatest(clock_timestamp(),max(occurred_at)+interval '1 microsecond') into event_time
  from public.item_events where tenant_id=p_tenant and item_id=p_item;
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)
  values(p_id,p_tenant,p_item,'collection_recorded',input,uid,event_time);
 perform komisio_private.record_access(p_tenant,'item.collection_recorded',p_item,
  jsonb_build_object('eventId',p_id,'collected',p_collected,'observedOn',p_observed_on));
 return p_id;
end $$;
revoke all on function public.record_item_collection(uuid,uuid,uuid,uuid,uuid,boolean,date,text) from public,anon,authenticated;
grant execute on function public.record_item_collection(uuid,uuid,uuid,uuid,uuid,boolean,date,text) to authenticated;
