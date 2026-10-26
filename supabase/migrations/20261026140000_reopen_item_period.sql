-- #636: corrections append facts; transfer and sale history remain immutable.
alter table public.item_events drop constraint item_events_kind_check;
alter table public.item_events add constraint item_events_kind_check check(kind in ('accepted','price_set','provenance','sold','returned','markdown_applied','period_extended','period_ended','collection_recorded','period_reopened','period_end_corrected'));

create function komisio_private.item_period_state(p_tenant uuid,p_item uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'kind',kind,'detail',detail,'occurredAt',occurred_at)
 from public.item_events where tenant_id=p_tenant and item_id=p_item
  and kind in ('period_ended','period_end_corrected','period_reopened')
 order by occurred_at desc,id desc limit 1
$$;
create function komisio_private.item_is_ended(p_tenant uuid,p_item uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(komisio_private.item_period_state(p_tenant,p_item)->>'kind'<>'period_reopened',false)
$$;
create function komisio_private.next_item_event_time(p_tenant uuid,p_item uuid) returns timestamptz
language sql volatile security definer set search_path='' as $$
 select greatest(clock_timestamp(),max(occurred_at)+interval '1 microsecond')
 from public.item_events where tenant_id=p_tenant and item_id=p_item
$$;
revoke all on function komisio_private.item_period_state(uuid,uuid),komisio_private.item_is_ended(uuid,uuid),komisio_private.next_item_event_time(uuid,uuid) from public,anon,authenticated;

-- Replace terminal-existence checks only in current stock/sale projections. The
-- historical monthly fee predicate intentionally stays unchanged: reopening
-- neither restarts billing nor charges the closed interval.
do $$
declare signature text; definition text; needle text; replacement text;
begin
 foreach signature in array array[
  'komisio_private.item_lifecycle_before_calendar(uuid,uuid)',
  'komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)',
  'komisio_private.stocktake_in_stock(uuid,uuid)',
  'public.sale_item_search(uuid,text)',
  'public.stock_assortment_report(uuid,text)',
  'public.stock_report_by_category(uuid,date,date,text)',
  'public.stock_report_by_ownership(uuid,date,date,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if signature like '%item_lifecycle_before_calendar%' then
   needle:='exists(select 1 from public.item_events where tenant_id=p_tenant and item_id=p_item and kind=''period_ended'')';
   replacement:='komisio_private.item_is_ended(p_tenant,p_item)';
  elsif signature like '%sale_line_facts%' or signature like '%stocktake_in_stock%' then
   needle:='exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=p_item and e.kind=''period_ended'')';
   replacement:='komisio_private.item_is_ended(p_tenant,p_item)';
  else
   needle:='exists(select 1 from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind=''period_ended'')';
   replacement:='komisio_private.item_is_ended(p_tenant,i.id)';
  end if;
  if position(needle in definition)=0 then raise exception 'UNEXPECTED_PERIOD_PREDICATE: %',signature; end if;
  execute replace(definition,needle,replacement);
 end loop;
end $$;

alter function komisio_private.item_lifecycle(uuid,uuid) rename to item_lifecycle_before_reopening;
create function komisio_private.item_lifecycle(p_tenant uuid,p_item uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; reopened public.item_events; extra integer; ends timestamptz; collection timestamptz; grace interval;
begin
 facts:=komisio_private.item_lifecycle_before_reopening(p_tenant,p_item);
 select * into reopened from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_reopened'
  order by occurred_at desc,id desc limit 1;
 if not found then return facts; end if;
 select coalesce(sum((detail->>'days')::integer),0) into extra from public.item_events
  where tenant_id=p_tenant and item_id=p_item and kind='period_extended' and occurred_at>reopened.occurred_at;
 ends:=(((reopened.detail->>'periodEnd')::timestamptz at time zone 'Europe/Stockholm')+make_interval(days=>extra)) at time zone 'Europe/Stockholm';
 if facts->>'collectionDeadline' is not null then
  grace:=((facts->>'collectionDeadline')::timestamptz at time zone 'Europe/Stockholm')-((facts->>'periodEnd')::timestamptz at time zone 'Europe/Stockholm');
  collection:=((ends at time zone 'Europe/Stockholm')+grace) at time zone 'Europe/Stockholm';
 end if;
 return facts||jsonb_build_object('periodEnd',ends,'collectionDeadline',collection,
  'stage',case when (facts->>'sold')::boolean then 'sold' when (facts->>'ended')::boolean then 'ended'
   when ends<=now() then 'period_ended' when facts->>'dueStep' is not null then 'markdown_due'
   when ends<=now()+interval '7 days' then 'period_ending' else 'on_sale' end);
end $$;
revoke all on function komisio_private.item_lifecycle(uuid,uuid),komisio_private.item_lifecycle_before_reopening(uuid,uuid) from public,anon,authenticated;

create function komisio_private.item_period_change_guard(p_tenant uuid,p_id uuid,p_item uuid,p_expected_end uuid,p_kind text,p_input jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.item_events; state jsonb; facts jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_item is null or p_expected_end is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.item_id is distinct from p_item or prior.actor is distinct from uid
   or prior.kind is distinct from p_kind or not(prior.detail @> p_input) then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 if (facts->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if exists(select 1 from public.item_events where tenant_id=p_tenant and item_id=p_item and kind='period_ended' and detail->>'action'='transfer')
  then raise exception 'ITEM_TRANSFER_TERMINAL'; end if;
 state:=komisio_private.item_period_state(p_tenant,p_item);
 if not (facts->>'ended')::boolean or state->>'id' is distinct from p_expected_end::text then raise exception 'ITEM_PERIOD_CHANGED'; end if;
 return true;
end $$;
revoke all on function komisio_private.item_period_change_guard(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

create function public.reopen_item_period(p_tenant uuid,p_id uuid,p_item uuid,p_expected_end uuid,p_sale_ends_on date,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare reason text:=trim(coalesce(p_reason,'')); input jsonb; facts jsonb; ends timestamptz;
begin
 if reason='' or length(reason)>500 or p_sale_ends_on is null or not isfinite(p_sale_ends_on)
  or p_sale_ends_on>date '9999-12-30' then raise exception 'INVALID_INPUT'; end if;
 input:=jsonb_build_object('expectedEndEventId',p_expected_end,'saleEndsOn',p_sale_ends_on,'reason',reason);
 if not komisio_private.item_period_change_guard(p_tenant,p_id,p_item,p_expected_end,'period_reopened',input) then return p_id; end if;
 if p_sale_ends_on<=(now() at time zone 'Europe/Stockholm')::date then raise exception 'INVALID_INPUT'; end if;
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 ends:=((p_sale_ends_on+1)::timestamp at time zone 'Europe/Stockholm')-interval '1 microsecond';
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)
 values(p_id,p_tenant,p_item,'period_reopened',input||jsonb_build_object('periodEnd',ends,'previousPeriodEnd',facts->>'periodEnd'),auth.uid(),komisio_private.next_item_event_time(p_tenant,p_item));
 perform komisio_private.record_access(p_tenant,'item.period_reopened',p_item,jsonb_build_object('eventId',p_id,'saleEndsOn',p_sale_ends_on));
 return p_id;
end $$;

create function public.correct_item_period_end(p_tenant uuid,p_id uuid,p_item uuid,p_expected_end uuid,p_action text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare reason text:=trim(coalesce(p_reason,'')); input jsonb; facts jsonb; previous_action text;
begin
 if reason='' or length(reason)>500 or p_action is null or p_action not in ('charity','return','recycle') then raise exception 'INVALID_INPUT'; end if;
 input:=jsonb_build_object('expectedEndEventId',p_expected_end,'action',p_action,'reason',reason);
 if not komisio_private.item_period_change_guard(p_tenant,p_id,p_item,p_expected_end,'period_end_corrected',input) then return p_id; end if;
 previous_action:=komisio_private.item_period_state(p_tenant,p_item)->'detail'->>'action';
 if previous_action=p_action then raise exception 'INVALID_INPUT'; end if;
 facts:=komisio_private.item_lifecycle(p_tenant,p_item);
 if p_action='recycle' and (facts->>'collectionDeadline' is null or (facts->>'collectionDeadline')::timestamptz>now()) then raise exception 'COLLECTION_NOT_DUE'; end if;
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)
 values(p_id,p_tenant,p_item,'period_end_corrected',input||jsonb_build_object('previousAction',previous_action),auth.uid(),komisio_private.next_item_event_time(p_tenant,p_item));
 perform komisio_private.record_access(p_tenant,'item.period_end_corrected',p_item,jsonb_build_object('eventId',p_id,'action',p_action));
 return p_id;
end $$;
revoke all on function public.reopen_item_period(uuid,uuid,uuid,uuid,date,text),public.correct_item_period_end(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reopen_item_period(uuid,uuid,uuid,uuid,date,text),public.correct_item_period_end(uuid,uuid,uuid,uuid,text,text) to authenticated;

-- Terminal writes made after reopening must sort after it, including within a
-- single transaction. Seller/collection reads follow the current end event.
do $$
declare definition text; signature text; needle text;
begin
 definition:=pg_get_functiondef('public.end_sale_period(uuid,uuid,uuid,text,text)'::regprocedure);
 needle:='insert into public.item_events(id,tenant_id,item_id,kind,detail,actor)';
 if position(needle in definition)=0 or position('''note'',note),uid);' in definition)=0 then raise exception 'UNEXPECTED_END_WRITE'; end if;
 definition:=replace(definition,needle,'insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)');
 execute replace(definition,'''note'',note),uid);','''note'',note),uid,komisio_private.next_item_event_time(p_tenant,p_item));');
 definition:=pg_get_functiondef('public.extend_sale_period(uuid,uuid,uuid,integer,text)'::regprocedure);
 if position(needle in definition)=0 or position('''reason'',note),uid);' in definition)=0 then raise exception 'UNEXPECTED_EXTEND_WRITE'; end if;
 definition:=replace(definition,needle,'insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)');
 execute replace(definition,'''reason'',note),uid);','''reason'',note),uid,komisio_private.next_item_event_time(p_tenant,p_item));');
 definition:=pg_get_functiondef('public.transfer_item(uuid,uuid,uuid,uuid,text)'::regprocedure);
 if position(needle in definition)=0 or position('''period_ended'',detail,uid);' in definition)=0 then raise exception 'UNEXPECTED_TRANSFER_WRITE'; end if;
 definition:=replace(definition,needle,'insert into public.item_events(id,tenant_id,item_id,kind,detail,actor,occurred_at)');
 execute replace(definition,'''period_ended'',detail,uid);','''period_ended'',detail,uid,komisio_private.next_item_event_time(p_from,p_item));');
 foreach signature in array array['public.my_items(uuid,uuid)','public.my_items_page(uuid,uuid,text,integer,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='(select e.detail->>''action'' from public.item_events e where e.tenant_id=p_tenant and e.item_id=i.id and e.kind=''period_ended'' order by e.occurred_at desc limit 1)';
  if position(needle in definition)=0 then raise exception 'UNEXPECTED_SELLER_END_READ: %',signature; end if;
  execute replace(definition,needle,'(komisio_private.item_period_state(p_tenant,i.id)->''detail''->>''action'')');
 end loop;
 definition:=pg_get_functiondef('public.record_item_collection(uuid,uuid,uuid,uuid,uuid,boolean,date,text)'::regprocedure);
 needle:='and kind=''period_ended''';
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_COLLECTION_END_READ'; end if;
 execute replace(definition,needle,'and kind in (''period_ended'',''period_end_corrected'')');
end $$;
