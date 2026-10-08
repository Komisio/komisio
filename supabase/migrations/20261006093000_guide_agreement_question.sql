-- Private onboarding context, never an active commercial policy.
create or replace function komisio_private.valid_store_guide(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; allowed jsonb; choices jsonb; consignment boolean; rental boolean;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['intake','goods','pricing','period','pos','channels'])
 or (value-array['intake','goods','pricing','period','pos','channels','agreement'])<>'{}'::jsonb then return false; end if;
 if value ? 'agreement' then
  choices:=value->'agreement';
  if jsonb_typeof(choices)<>'array' then return false; end if;
  if jsonb_array_length(choices)>1 or not ('["yes","no","later"]'::jsonb @> choices) then return false; end if;
 end if;
 foreach k in array array['intake','goods','pricing','period','pos','channels'] loop
  choices:=value->k;
  if jsonb_typeof(choices)<>'array' then return false; end if;
  if jsonb_array_length(choices)>7 or (k<>'period' and jsonb_array_length(choices)=0) then return false; end if;
  allowed:=case k
   when 'intake' then '["single","bags","owned","new","pickup","space","other"]'::jsonb
   when 'goods' then '["clothes","kids","home","furniture","hobby","mixed","other"]'::jsonb
   when 'pricing' then '["store","together","seller","suggestion","both","later"]'::jsonb
   when 'period' then '["collect","donate","extend","individual","later"]'::jsonb
   when 'pos' then '["zettle","shopify","other","later"]'::jsonb
   when 'channels' then '["shop","web","social","market","later"]'::jsonb end;
  if not(allowed @> choices) or exists(select 1 from jsonb_array_elements(choices) e where jsonb_typeof(e)<>'string') then return false; end if;
  if (select count(distinct e) from jsonb_array_elements(choices) e)<>jsonb_array_length(choices) then return false; end if;
  if k in ('pricing','pos') and jsonb_array_length(choices)<>1 then return false; end if;
  if choices ? 'later' and jsonb_array_length(choices)<>1 then return false; end if;
 end loop;
 consignment:=(value->'intake') ?| array['single','bags','pickup'];
 rental:=(value->'intake') ? 'space' and not consignment and not((value->'intake') ?| array['owned','new']);
 if consignment<>(jsonb_array_length(value->'period')>0) then return false; end if;
 if rental then return ' ["store","seller","both","later"]'::jsonb @> (value->'pricing'); end if;
 if consignment then return '["store","together","seller","later"]'::jsonb @> (value->'pricing'); end if;
 return '["store","suggestion","later"]'::jsonb @> (value->'pricing');
end $$;
revoke all on function komisio_private.valid_store_guide(jsonb) from public,anon,authenticated;

