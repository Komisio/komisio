create or replace function list_members(p_tenant uuid) returns table(user_id uuid,display_name text,email text,role text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
 perform komisio_private.require_identity();
 actor_role:=public.tenant_role(p_tenant);
 if actor_role is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return query select m.user_id,coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),
 case when actor_role in ('owner','admin') or m.user_id=auth.uid() then u.email::text else null end,
 m.role,m.created_at
 from public.tenant_members m join auth.users u on u.id=m.user_id
 left join public.user_profiles p on p.user_id=m.user_id where m.tenant_id=p_tenant order by m.created_at;
end $$;


