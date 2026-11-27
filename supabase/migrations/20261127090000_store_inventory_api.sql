-- An inventory credential identifies a single store. It cannot act as a user.
create table komisio_private.store_inventory_keys (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 issued_by uuid not null references auth.users(id),
 label text not null check (length(label) between 1 and 80),
 scopes text[] not null check(cardinality(scopes) between 1 and 9 and array_position(scopes,null) is null and scopes <@ array['items:read','items:write','sellers:read','sellers:write','sales:read','sales:write','returns:read','returns:write','payouts:read']),
 secret_hash bytea not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '90 days',
 revoked_at timestamptz,
 window_start timestamptz,
 requests integer not null default 0
);
create index store_inventory_keys_tenant on komisio_private.store_inventory_keys(tenant_id);
alter table komisio_private.store_inventory_keys enable row level security;
revoke all on komisio_private.store_inventory_keys from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate
 on komisio_private.store_inventory_keys for each statement execute function komisio_private.guard_support_write();

create function public.store_inventory_keys(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.tenant_role(p_tenant) is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'expiresAt',expires_at,'scopes',scopes) order by created_at,id),'[]'::jsonb)
  from komisio_private.store_inventory_keys where tenant_id=p_tenant and revoked_at is null and expires_at>now());
end $$;

create function public.issue_store_inventory_key(p_tenant uuid,p_label text,p_scopes text[] default array['items:read']) returns text
language plpgsql security definer set search_path='' as $$
declare secret text; key_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if public.tenant_role(p_tenant) is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_label is null or length(trim(p_label)) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from komisio_private.store_inventory_keys where tenant_id=p_tenant and revoked_at is null and expires_at>now())>=10 then raise exception 'KEY_LIMIT'; end if;
 secret:='kmi_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into komisio_private.store_inventory_keys(tenant_id,issued_by,label,scopes,secret_hash)
 values(p_tenant,auth.uid(),trim(p_label),p_scopes,extensions.digest(secret,'sha256')) returning id into key_id;
 perform komisio_private.record_access(p_tenant,'store_api.key_issued',key_id,'{}'::jsonb);
 return secret;
end $$;

create function public.revoke_store_inventory_key(p_tenant uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.tenant_role(p_tenant) is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update komisio_private.store_inventory_keys set revoked_at=now() where tenant_id=p_tenant and id=p_id and revoked_at is null;
 if found then perform komisio_private.record_access(p_tenant,'store_api.key_revoked',p_id,'{}'::jsonb); end if;
end $$;

create function komisio_private.claim_store_api_key(p_secret text,p_scope text) returns komisio_private.store_inventory_keys
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; bucket timestamptz;
begin
 if p_secret is null or length(p_secret)<>68 or p_secret !~ '^kmi_[0-9a-f]{64}$' then raise exception 'INVALID_KEY'; end if;
 select s.* into k from komisio_private.store_inventory_keys s
 join public.tenant_members m on m.tenant_id=s.tenant_id and m.user_id=s.issued_by and m.role='owner'
 join auth.users u on u.id=m.user_id and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 where s.secret_hash=extensions.digest(p_secret,'sha256') and s.revoked_at is null and s.expires_at>statement_timestamp() for update of s;
 if not found then raise exception 'INVALID_KEY'; end if;
 if p_scope is not null and not(p_scope=any(k.scopes)) then raise exception 'INSUFFICIENT_SCOPE'; end if;
 bucket:=date_trunc('minute',clock_timestamp());
 if k.window_start=bucket and k.requests>=60 then raise exception 'RATE_LIMIT'; end if;
 update komisio_private.store_inventory_keys set window_start=bucket,requests=case when window_start=bucket then requests+1 else 1 end where id=k.id;
 return k;
end $$;
revoke all on function komisio_private.claim_store_api_key(text,text) from public,anon,authenticated;

-- Paginate IDs first. Compute catalogue details for at most one page of items.
create function public.read_store_inventory(p_secret text,p_limit integer,p_after uuid,p_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; ids uuid[]; rows jsonb; currency text;
begin
 k:=komisio_private.claim_store_api_key(p_secret,'items:read');
 if p_limit is null or p_limit not between 1 and 100 or (p_item is not null and p_after is not null) then raise exception 'INVALID_INPUT'; end if;
 select array(select id from public.items where tenant_id=k.tenant_id and (p_item is null or id=p_item)
  and (p_after is null or id>p_after) order by id limit p_limit+1) into ids;
 currency:=komisio_private.store_currency(k.tenant_id);
 with facts as materialized (
  select id,komisio_private.item_title(k.tenant_id,id) as title,komisio_private.item_lifecycle(k.tenant_id,id) as state
  from unnest(ids[1:p_limit]) as i(id)
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title->>'title','category',title->>'category',
  'stage',state->>'stage','priceMinor',(state->>'currentPriceOre')::bigint,'currency',currency) order by id),'[]'::jsonb) into rows from facts;
 return jsonb_build_object('items',rows,'nextCursor',case when cardinality(ids)>p_limit then ids[p_limit] end);
end $$;

revoke all on function public.store_inventory_keys(uuid),public.issue_store_inventory_key(uuid,text,text[]),public.revoke_store_inventory_key(uuid,uuid),public.read_store_inventory(text,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.store_inventory_keys(uuid),public.issue_store_inventory_key(uuid,text,text[]),public.revoke_store_inventory_key(uuid,uuid) to authenticated;
grant execute on function public.read_store_inventory(text,integer,uuid,uuid) to anon;
