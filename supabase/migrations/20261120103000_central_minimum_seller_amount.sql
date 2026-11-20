-- Both central commands already verify the owner, exact replay and current
-- recipient here. Their shorter overloads delegate to these implementations.
do $migration$
declare
  command regprocedure;
  definition text;
  anchor constant text := 'perform 1 from public.tenants where id=p_tenant for update;';
begin
  foreach command in array array[
    'public.submit_external_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text)'::regprocedure,
    'public.submit_central_item_request(uuid,uuid,text,text,text,text,numeric,text,uuid[],text,text,uuid,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(command);
    if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
      raise exception 'Unexpected central submission definition for %', command;
    end if;
    execute replace(definition, anchor, anchor || $minimum$
 if p_price_basis is distinct from 'seller_amount' or p_price_ore is null or p_price_ore < 30000 then
   raise exception 'PRICE_REQUIRED';
 end if;$minimum$);
  end loop;
end
$migration$;
