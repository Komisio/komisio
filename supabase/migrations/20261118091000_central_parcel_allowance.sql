-- Permit corrected light-parcel estimates while retaining all historical
-- bookings, including 3000 g estimates created under the previous rule.
alter table public.central_parcels drop constraint central_parcels_estimated_weight_g_check;
alter table public.central_parcels add constraint central_parcels_estimated_weight_g_check
 check(estimated_weight_g between 101 and 3000);

create or replace function komisio_private.central_parcel_estimated_weight(p_offers uuid[],p_service text) returns integer
language plpgsql stable security invoker set search_path='' as $$
declare grams bigint;
begin
 if p_service<>'11' then return null; end if;
 select sum(komisio_private.external_item_selection_weight(o.request_id)) into grams
 from public.external_item_offers o where o.id=any(p_offers);
 if grams is null or grams>2500 then raise exception 'PARCEL_WEIGHT_LIMIT'; end if;
 return grams::integer+100;
end $$;
revoke all on function komisio_private.central_parcel_estimated_weight(uuid[],text) from public,anon,authenticated;

do $$ declare definition text; needle text:='case when c.service_code=''11'' then 2000 end'; begin
 definition:=replace(pg_get_functiondef('public.read_central_parcel(uuid)'::regprocedure),E'\r','');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_PARCEL_SELECTION_LIMIT'; end if;
 execute replace(definition,needle,'case when c.service_code=''11'' then 2500 end');
end $$;
