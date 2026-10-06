create or replace function public.public_pricing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp()); attempts bigint; avg_ore numeric;
begin
 select count(*),coalesce(avg(-amount_ore),0) into attempts,avg_ore from public.ai_credit_events e where e.kind='settled' and e.created_at>now()-interval '90 days';
 return jsonb_build_object('includedOre',s.ai_included_ore,'packOre',s.ai_pack_ore,
  'estimatedItemsPerMonth',case when attempts>=20 and avg_ore>0 then floor(s.ai_included_ore/avg_ore)::int else floor(s.ai_included_ore/s.ai_reserve_ore*2.5)::int end,
  'measured',attempts>=20,
  'stores','[]'::jsonb);
end $$;

-- Retain historical configuration without permitting further publication.
revoke all on function public.set_store_showcase(uuid,text) from public, anon, authenticated;
