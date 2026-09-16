-- A call cap per connected assistant (2026-09-16, Opus). The MCP endpoint is
-- open to the internet and a grant's token buys unlimited calls, so one store's
-- runaway assistant could saturate the shared database and slow every other
-- store. A grant may make at most the host's number of calls per rolling day.
-- The number is deliberately far above what a person asking questions reaches;
-- it stops a loop, not a conversation. Counted on the calls already recorded,
-- so a refused call is not itself recorded and cannot deepen the hole.
alter table public.platform_settings
 add column connector_daily_cap integer not null default 2000 check(connector_daily_cap>=0);

create or replace function public.connector_call(p_access_hash text,p_function text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.connector_grants:=komisio_private.connector_grant_for(p_access_hash); fn record; arglist text; sql text; out jsonb; names text[]; types text[]; i integer; expr text; typ text; unknown text;
begin
 if p_function !~ '^[a-z_]{1,63}$' or p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.connector_functions f where f.function_name=p_function and (f.scope='*' or f.scope=any(g.scopes)) and (f.kind='' or f.kind=p_args->>'kind' or f.kind=p_args->>'p_kind')) then
  raise exception 'SCOPE_REQUIRED' using errcode='42501';
 end if;
 if coalesce(p_args->>'p_tenant','')<>g.tenant_id::text then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (select count(*) from public.connector_calls k where k.grant_id=g.id and k.called_at>now()-interval '1 day')
  >=(select s.connector_daily_cap from public.platform_settings s) then raise exception 'CONNECTOR_RATE_LIMIT' using errcode='55000'; end if;
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

create or replace function public.ai_platform_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp());
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('enabled',s.ai_credits_enabled,'monthlyCapOre',s.ai_monthly_cap_ore,'includedOre',s.ai_included_ore,'packOre',s.ai_pack_ore,
  'reserveOre',s.ai_reserve_ore,'reserveBatchOre',s.ai_reserve_batch_ore,'inputOrePerMillion',s.ai_input_ore_per_million,'outputOrePerMillion',s.ai_output_ore_per_million,
  'period',p,'capUsedOre',komisio_private.ai_cap_used(p),
  'connectorDailyCap',s.connector_daily_cap,'emailDailyCap',s.email_daily_cap,'inviteDailyCap',s.invite_daily_cap,
  'showcase',coalesce((select jsonb_agg(jsonb_build_object('tenantId',x.tenant_id,'label',x.label) order by x.added_at) from public.store_showcase x),'[]'::jsonb));
end $$;

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
  connector_daily_cap=coalesce((p->>'connectorDailyCap')::integer,connector_daily_cap),
  email_daily_cap=coalesce((p->>'emailDailyCap')::integer,email_daily_cap),
  invite_daily_cap=coalesce((p->>'inviteDailyCap')::integer,invite_daily_cap),
  updated_at=now() where only_row=true;
 return public.ai_platform_settings();
end $$;
