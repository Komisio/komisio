-- Target the singleton explicitly: staging runs the safeupdate guard.
create or replace function public.set_ai_platform_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'INVALID_INPUT'; end if;
 update public.platform_settings set
  ai_credits_enabled=coalesce((p->>'enabled')::boolean,ai_credits_enabled),
  ai_monthly_cap_ore=coalesce((p->>'monthlyCapOre')::bigint,ai_monthly_cap_ore),
  ai_included_ore=coalesce((p->>'includedOre')::integer,ai_included_ore),
  ai_pack_ore=coalesce((p->>'packOre')::integer,ai_pack_ore),
  ai_reserve_ore=coalesce((p->>'reserveOre')::integer,ai_reserve_ore),
  ai_reserve_batch_ore=coalesce((p->>'reserveBatchOre')::integer,ai_reserve_batch_ore),
  ai_input_ore_per_million=coalesce((p->>'inputOrePerMillion')::numeric,ai_input_ore_per_million),
  ai_output_ore_per_million=coalesce((p->>'outputOrePerMillion')::numeric,ai_output_ore_per_million),
  updated_at=now() where only_row=true;
 return public.ai_platform_settings();
end $$;

