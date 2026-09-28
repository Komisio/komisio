create or replace function komisio_private.valid_seller_profile(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 if not(p ?& array['name','email','phone','addressLine1','addressLine2','postalCode','city','country','language','notes']) or (p-array['nationalId','name','email','phone','addressLine1','addressLine2','postalCode','city','country','language','notes'])<>'{}' then return false; end if;
 for k in select jsonb_object_keys(p) loop
  if jsonb_typeof(p->k)<>'string' then return false; end if;
 end loop;
 return length(trim(p->>'name')) between 1 and 120
 and (not(p ? 'nationalId') or length(p->>'nationalId')<=40)
 and length(p->>'email')<=254 and length(p->>'phone')<=40
 and (trim(p->>'email')<>'' or trim(p->>'phone')<>'')
 and (p->>'email'='' or p->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 and length(p->>'addressLine1')<=160 and length(p->>'addressLine2')<=160
 and length(p->>'postalCode')<=24 and length(p->>'city')<=120 and length(p->>'country')<=80
 and p->>'language' in ('','sv','en','no','dk','fi','de','es','it') and length(p->>'notes')<=1000;
end $$;
revoke all on function komisio_private.valid_seller_profile(jsonb) from public,anon,authenticated;

-- Registration and its optional profile are one transaction. Existing engine
-- functions retain role/MFA checks and bind replays to the original actor/input.
create function public.register_seller_with_profile(p_tenant uuid,p_id uuid,p_profile jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not komisio_private.valid_seller_profile(p_profile) then raise exception 'INVALID_INPUT'; end if;
 perform public.register_seller(p_tenant,p_id,p_profile->>'name',p_profile->>'email',p_profile->>'phone');
 perform public.save_seller_profile(p_tenant,p_id,p_id,0,p_profile);
 return p_id;
end $$;
revoke all on function public.register_seller_with_profile(uuid,uuid,jsonb) from public,anon;
grant execute on function public.register_seller_with_profile(uuid,uuid,jsonb) to authenticated;
