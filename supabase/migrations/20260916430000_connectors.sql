-- Hosted MCP connector (owner direction 2026-09-16: a store connects its own
-- AI assistant to Komisio the way Accounted-style connectors work, without
-- installing anything). Komisio is the OAuth 2.1 authorization server for
-- its own MCP endpoint: an assistant registers as a public client, a member
-- approves it for one store and a set of scopes, and the assistant holds a
-- short-lived access token. The token is never a Supabase JWT and never a
-- service key: every tool call goes through connector_call, which looks the
-- token up, binds the store, checks the scope of the exact function and
-- operation kind, sets the request claims to the person who approved the
-- grant and calls the same engine function the person's own session would
-- call. The engine functions keep their own role, plan and revision checks;
-- proposals carry the person as proposer, so the four-eyes rule holds. The
-- connector is a Butik Plus feature. Tokens are stored as SHA-256 hashes;
-- refresh tokens rotate and a reused one revokes the grant.
create table public.connector_clients(
 id uuid primary key,
 name text not null check(length(name) between 1 and 100),
 redirect_uris text[] not null check(cardinality(redirect_uris) between 1 and 10),
 created_at timestamptz not null default now()
);
create table public.connector_grants(
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 user_id uuid not null references auth.users(id),
 client_id uuid not null references public.connector_clients(id),
 scopes text[] not null check(cardinality(scopes) between 1 and 20),
 aal text not null check(aal in ('aal1','aal2')),
 created_at timestamptz not null default now(),
 last_used_at timestamptz,
 revoked_at timestamptz,
 revoked_by uuid references auth.users(id)
);
create index connector_grants_tenant on public.connector_grants(tenant_id) where revoked_at is null;
create table public.connector_codes(
 code_hash text primary key check(code_hash ~ '^[0-9a-f]{64}$'),
 grant_id uuid not null references public.connector_grants(id),
 redirect_uri text not null,
 code_challenge text not null check(code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
 expires_at timestamptz not null,
 used_at timestamptz
);
create table public.connector_tokens(
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 grant_id uuid not null references public.connector_grants(id),
 kind text not null check(kind in ('access','refresh')),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 used_at timestamptz
);
create index connector_tokens_grant on public.connector_tokens(grant_id);
create table public.connector_calls(
 id bigint generated always as identity primary key,
 grant_id uuid not null references public.connector_grants(id),
 tenant_id uuid not null,
 function_name text not null,
 called_at timestamptz not null default now()
);
create index connector_calls_grant on public.connector_calls(grant_id,called_at desc);
-- The functions a connector may call, each under the scope that covers it.
-- propose_operation is listed per operation kind. '*' is any grant.
create table public.connector_functions(
 function_name text not null,
 scope text not null,
 kind text not null default '',
 primary key(function_name,scope,kind)
);
insert into public.connector_functions(function_name,scope,kind) values
 ('tenant_role','*',''),('current_store_policy','*',''),('store_currency','*',''),
 ('operation_queue_filtered_page','reception:read','publishReceptionReview'),
 ('operation_queue_filtered_page','inspection:read','saveInspectionDraft'),
 ('price_evidence','reception:read',''),('price_evidence','lifecycle:propose',''),('photo_duplicates','reception:read',''),
 ('items_overview','items:read',''),
 ('economy_summary','economy:read',''),('economy_brief','economy:read',''),('stock_report','economy:read',''),('seller_balance','economy:read',''),
 ('settlement_candidates','payouts:propose',''),
 ('current_accounting_map','accounting:read',''),('preview_voucher','accounting:read',''),('accounting_reconciliation','accounting:read',''),
 ('current_store_profile','store:read',''),
 ('propose_operation','inspection:propose','saveInspectionDraft'),('propose_operation','items:propose','acceptItem'),
 ('propose_operation','sales:propose','recordReturn'),('propose_operation','ledger:propose','adjustLedger'),
 ('propose_operation','lifecycle:propose','applyMarkdownBatch'),('propose_operation','lifecycle:propose','bulkItemUpdate'),
 ('propose_operation','communications:propose','sendMessage'),('propose_operation','payouts:propose','approvePayout'),
 ('propose_operation','payouts:propose','markPayoutPaid'),('propose_operation','payouts:propose','settlePayouts'),
 ('propose_operation','accounting:propose','exportDayClose'),('propose_operation','store:propose','updateStoreProfile');
alter table public.connector_clients enable row level security;
alter table public.connector_grants enable row level security;
alter table public.connector_codes enable row level security;
alter table public.connector_tokens enable row level security;
alter table public.connector_calls enable row level security;
alter table public.connector_functions enable row level security;
revoke all on public.connector_clients,public.connector_grants,public.connector_codes,public.connector_tokens,public.connector_calls,public.connector_functions from public,anon,authenticated;

create function komisio_private.connector_scopes() returns text[] language sql immutable set search_path='' as $$
 select array['reception:read','reception:preview','reception:propose','inspection:read','inspection:preview','inspection:propose','items:read','items:propose','economy:read','sales:read','sales:propose','ledger:propose','lifecycle:propose','communications:propose','payouts:propose','accounting:read','accounting:propose','store:read','store:propose']
$$;
create function komisio_private.connector_redirect_valid(u text) returns boolean language sql immutable set search_path='' as $$
 select u is not null and length(u)<=2000 and (u ~ '^https://[^\s#]+$' or u ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^\s#]*)?$')
$$;
create function komisio_private.connector_grant_state(g public.connector_grants) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',g.id,'tenantId',g.tenant_id,'userId',g.user_id,'clientId',g.client_id,
  'clientName',(select c.name from public.connector_clients c where c.id=g.client_id),
  'userName',coalesce((select nullif(p.display_name,'') from public.user_profiles p where p.user_id=g.user_id),(select u.email from auth.users u where u.id=g.user_id)),
  'scopes',to_jsonb(g.scopes),'createdAt',g.created_at,'lastUsedAt',g.last_used_at,'revokedAt',g.revoked_at,
  'calls',(select count(*) from public.connector_calls k where k.grant_id=g.id and k.called_at>now()-interval '30 days'));
$$;
revoke all on function komisio_private.connector_scopes(),komisio_private.connector_redirect_valid(text),komisio_private.connector_grant_state(public.connector_grants) from public,anon,authenticated;

-- Dynamic client registration (RFC 7591): public clients only, no secret.
create function public.register_connector_client(p_id uuid,p_name text,p_redirect_uris text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare name text:=trim(p_name); existing public.connector_clients;
begin
 if p_id is null or name is null or length(name) not between 1 and 100 or p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 10
  or exists(select 1 from unnest(p_redirect_uris) u where not komisio_private.connector_redirect_valid(u)) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.connector_clients where id=p_id;
 if found then
  if existing.name<>name or existing.redirect_uris<>p_redirect_uris then raise exception 'REQUEST_CONFLICT'; end if;
 else
  if (select count(*) from public.connector_clients where created_at>now()-interval '1 hour')>=200 then raise exception 'RATE_LIMITED' using errcode='55000'; end if;
  insert into public.connector_clients(id,name,redirect_uris) values(p_id,name,p_redirect_uris) returning * into existing;
 end if;
 return jsonb_build_object('clientId',existing.id,'name',existing.name,'redirectUris',to_jsonb(existing.redirect_uris));
end $$;
create function public.connector_client(p_client uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('clientId',c.id,'name',c.name,'redirectUris',to_jsonb(c.redirect_uris)) from public.connector_clients c where c.id=p_client;
$$;

-- A member approves a client for one store: the grant and a one-time code.
create function public.authorize_connector(p_id uuid,p_tenant uuid,p_client uuid,p_redirect_uri text,p_scopes text[],p_code_challenge text,p_code_hash text,p_aal text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); c public.connector_clients; g public.connector_grants;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform komisio_private.require_plus(p_tenant,'connector');
 select * into c from public.connector_clients where id=p_client;
 if not found or p_redirect_uri is null or not (p_redirect_uri=any(c.redirect_uris)) then raise exception 'INVALID_INPUT'; end if;
 if p_id is null or p_scopes is null or cardinality(p_scopes) not between 1 and 20 or (select count(distinct s) from unnest(p_scopes) s)<>cardinality(p_scopes)
  or exists(select 1 from unnest(p_scopes) s where not (s=any(komisio_private.connector_scopes())))
  or p_code_challenge !~ '^[A-Za-z0-9_-]{43,128}$' or p_code_hash !~ '^[0-9a-f]{64}$' or p_aal not in ('aal1','aal2') then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.connector_grants where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 insert into public.connector_grants(id,tenant_id,user_id,client_id,scopes,aal) values(p_id,p_tenant,uid,p_client,p_scopes,p_aal) returning * into g;
 insert into public.connector_codes(code_hash,grant_id,redirect_uri,code_challenge,expires_at) values(p_code_hash,p_id,p_redirect_uri,p_code_challenge,now()+interval '10 minutes');
 perform komisio_private.record_access(p_tenant,'connector.authorized',p_id,jsonb_build_object('client',c.name,'scopes',to_jsonb(p_scopes)));
 return komisio_private.connector_grant_state(g);
end $$;

create function komisio_private.connector_token_state(g public.connector_grants,p_expires timestamptz) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('grantId',g.id,'tenantId',g.tenant_id,'userId',g.user_id,'clientId',g.client_id,'scopes',to_jsonb(g.scopes),'expiresAt',p_expires,
  'clientName',(select c.name from public.connector_clients c where c.id=g.client_id));
$$;
revoke all on function komisio_private.connector_token_state(public.connector_grants,timestamptz) from public,anon,authenticated;

-- The token endpoint: code plus PKCE verifier (the caller hands over the
-- S256 challenge it computed from the verifier) for an access and a refresh token.
create function public.exchange_connector_code(p_code_hash text,p_client uuid,p_redirect_uri text,p_code_challenge text,p_access_hash text,p_refresh_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.connector_codes; g public.connector_grants; expires timestamptz:=now()+interval '1 hour';
begin
 if p_access_hash !~ '^[0-9a-f]{64}$' or p_refresh_hash !~ '^[0-9a-f]{64}$' or p_access_hash=p_refresh_hash then raise exception 'INVALID_INPUT'; end if;
 select * into k from public.connector_codes where code_hash=p_code_hash for update;
 if not found then raise exception 'CONNECTOR_CODE_INVALID' using errcode='42501'; end if;
 select * into g from public.connector_grants where id=k.grant_id for update;
 if k.used_at is not null then raise exception 'CONNECTOR_CODE_REUSED' using errcode='42501'; end if;
 if k.expires_at<=now() or g.revoked_at is not null or g.client_id is distinct from p_client or k.redirect_uri is distinct from p_redirect_uri or k.code_challenge is distinct from p_code_challenge then
  raise exception 'CONNECTOR_CODE_INVALID' using errcode='42501';
 end if;
 update public.connector_codes set used_at=now() where code_hash=p_code_hash;
 insert into public.connector_tokens(token_hash,grant_id,kind,expires_at) values(p_access_hash,g.id,'access',expires),(p_refresh_hash,g.id,'refresh',now()+interval '30 days');
 return komisio_private.connector_token_state(g,expires);
end $$;
create function public.refresh_connector_token(p_refresh_hash text,p_client uuid,p_access_hash text,p_new_refresh_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.connector_tokens; g public.connector_grants; expires timestamptz:=now()+interval '1 hour';
begin
 if p_access_hash !~ '^[0-9a-f]{64}$' or p_new_refresh_hash !~ '^[0-9a-f]{64}$' or p_access_hash=p_new_refresh_hash then raise exception 'INVALID_INPUT'; end if;
 select * into t from public.connector_tokens where token_hash=p_refresh_hash and kind='refresh' for update;
 if not found then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 select * into g from public.connector_grants where id=t.grant_id for update;
 if t.used_at is not null then raise exception 'CONNECTOR_TOKEN_REUSED' using errcode='42501'; end if;
 if g.revoked_at is not null then raise exception 'CONNECTOR_REVOKED' using errcode='42501'; end if;
 if t.expires_at<=now() or g.client_id is distinct from p_client then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 update public.connector_tokens set used_at=now() where token_hash=p_refresh_hash;
 insert into public.connector_tokens(token_hash,grant_id,kind,expires_at) values(p_access_hash,g.id,'access',expires),(p_new_refresh_hash,g.id,'refresh',now()+interval '30 days');
 return komisio_private.connector_token_state(g,expires);
end $$;

-- A replayed code or refresh token means the secret leaked: the token endpoint
-- voids the grant in its own transaction (a raise would undo the update).
-- Holding a secret's hash is holding the secret, so voiding needs no session.
create function public.void_connector_secret(p_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
 if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INPUT'; end if;
 select grant_id into gid from public.connector_codes where code_hash=p_hash;
 if gid is null then select grant_id into gid from public.connector_tokens where token_hash=p_hash; end if;
 if gid is not null then update public.connector_grants set revoked_at=coalesce(revoked_at,now()) where id=gid; end if;
end $$;

create function komisio_private.connector_grant_for(p_access_hash text) returns public.connector_grants
language plpgsql stable set search_path='' as $$
declare t public.connector_tokens; g public.connector_grants;
begin
 if p_access_hash !~ '^[0-9a-f]{64}$' then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 select * into t from public.connector_tokens where token_hash=p_access_hash and kind='access';
 if not found or t.expires_at<=now() then raise exception 'CONNECTOR_TOKEN_INVALID' using errcode='42501'; end if;
 select * into g from public.connector_grants where id=t.grant_id;
 if g.revoked_at is not null then raise exception 'CONNECTOR_REVOKED' using errcode='42501'; end if;
 if komisio_private.plan_tier(g.tenant_id)<>'plus' then raise exception 'PLAN_PLUS_REQUIRED' using errcode='55000', detail='connector'; end if;
 return g;
end $$;
revoke all on function komisio_private.connector_grant_for(text) from public,anon,authenticated;
create function public.connector_token_info(p_access_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.connector_grants:=komisio_private.connector_grant_for(p_access_hash);
begin
 return komisio_private.connector_token_state(g,(select t.expires_at from public.connector_tokens t where t.token_hash=p_access_hash));
end $$;

-- One tool call: the function must be listed under a scope of the grant (and
-- the operation kind, for proposals), p_tenant must be the granted store, and
-- the person must still be a member. The request claims become the person's
-- for the rest of the transaction, so the engine function sees the same
-- identity, role and assurance level as that person's own session.
create function public.connector_call(p_access_hash text,p_function text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.connector_grants:=komisio_private.connector_grant_for(p_access_hash); fn record; arglist text; sql text; out jsonb; names text[]; types text[]; i integer; expr text; typ text; unknown text;
begin
 if p_function !~ '^[a-z_]{1,63}$' or p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.connector_functions f where f.function_name=p_function and (f.scope='*' or f.scope=any(g.scopes)) and (f.kind='' or f.kind=p_args->>'kind' or f.kind=p_args->>'p_kind')) then
  raise exception 'SCOPE_REQUIRED' using errcode='42501';
 end if;
 if coalesce(p_args->>'p_tenant','')<>g.tenant_id::text then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',g.user_id,'role','authenticated','aal',g.aal,'amr',jsonb_build_array(jsonb_build_object('method','connector')),'connector',g.id)::text,true);
 perform set_config('komisio.connector',g.id::text,true);
 if coalesce(public.tenant_role(g.tenant_id),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select p.oid,p.proretset,p.prorettype::regtype::text as rettype,p.proargnames,
  (select array_agg(t::regtype::text order by ord) from unnest(p.proargtypes::oid[]) with ordinality u(t,ord)) as argtypes
  into fn from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=p_function order by p.pronargs desc limit 1;
 if not found then raise exception 'INVALID_INPUT'; end if;
 names:=fn.proargnames; types:=fn.argtypes;
 select string_agg(key,', ') into unknown from jsonb_object_keys(p_args) key where not (key=any(names));
 if unknown is not null then raise exception 'INVALID_INPUT'; end if;
 arglist:='';
 for i in 1..coalesce(cardinality(names),0) loop
  if p_args ? names[i] then
   typ:=types[i];
   if typ in ('jsonb','json') then expr:=format('($1->%L)::%s',names[i],typ);
   elsif typ like '%[]' then expr:=format('(select array_agg(x::%s) from jsonb_array_elements_text($1->%L) x)',left(typ,length(typ)-2),names[i]);
   else expr:=format('($1->>%L)::%s',names[i],typ);
   end if;
   arglist:=arglist||case when arglist='' then '' else ', ' end||format('%I => %s',names[i],expr);
  end if;
 end loop;
 if fn.proretset then sql:=format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I(%s) r',p_function,arglist);
 elsif fn.rettype='void' then sql:=format('select public.%I(%s)',p_function,arglist);
 else sql:=format('select to_jsonb(public.%I(%s))',p_function,arglist);
 end if;
 execute sql into out using p_args;
 if fn.rettype='void' then out:='null'::jsonb; end if;
 insert into public.connector_calls(grant_id,tenant_id,function_name) values(g.id,g.tenant_id,p_function);
 update public.connector_grants set last_used_at=now() where id=g.id and (last_used_at is null or last_used_at<now()-interval '1 minute');
 return out;
end $$;

-- Members see the store's connectors (owner and admin: all; others: their own) and disconnect them.
create function public.connectors(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); role text:=coalesce(public.tenant_role(p_tenant),'');
begin
 if role not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(komisio_private.connector_grant_state(g) order by g.created_at desc) from public.connector_grants g
  where g.tenant_id=p_tenant and g.revoked_at is null and (role in ('owner','admin') or g.user_id=uid)),'[]'::jsonb);
end $$;
create function public.revoke_connector(p_tenant uuid,p_grant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); role text:=coalesce(public.tenant_role(p_tenant),''); g public.connector_grants;
begin
 select * into g from public.connector_grants where id=p_grant and tenant_id=p_tenant for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if not (role in ('owner','admin') or (role in ('staff','readonly') and g.user_id=uid)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if g.revoked_at is null then
  update public.connector_grants set revoked_at=now(),revoked_by=uid where id=p_grant returning * into g;
  perform komisio_private.record_access(p_tenant,'connector.revoked',p_grant,'{}'::jsonb);
 end if;
 return komisio_private.connector_grant_state(g);
end $$;
revoke all on function public.register_connector_client(uuid,text,text[]),public.connector_client(uuid),public.authorize_connector(uuid,uuid,uuid,text,text[],text,text,text),
 public.exchange_connector_code(text,uuid,text,text,text,text),public.refresh_connector_token(text,uuid,text,text),public.connector_token_info(text),public.void_connector_secret(text),
 public.connector_call(text,text,jsonb),public.connectors(uuid),public.revoke_connector(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_connector_client(uuid,text,text[]),public.connector_client(uuid),public.exchange_connector_code(text,uuid,text,text,text,text),
 public.refresh_connector_token(text,uuid,text,text),public.connector_token_info(text),public.void_connector_secret(text),public.connector_call(text,text,jsonb) to anon,authenticated;
grant execute on function public.authorize_connector(uuid,uuid,uuid,text,text[],text,text,text),public.connectors(uuid),public.revoke_connector(uuid,uuid) to authenticated;
