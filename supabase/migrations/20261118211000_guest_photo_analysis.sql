-- Temporary analysis data only: no identity, request, seller or balance.
-- Images are processed in server memory and never stored in this guest flow.
create table public.guest_photo_ai_attempts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 network_hash text not null check(network_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 photos uuid[] not null check(cardinality(photos) between 1 and 8),
 language text not null check(language in ('sv','en','no','dk','fi','de','es','it')),
 model text not null,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 evidence jsonb,
 output jsonb,
 input_tokens integer,
 output_tokens integer
);
create index guest_ai_token_time on public.guest_photo_ai_attempts(token_hash,created_at);
create index guest_ai_network_time on public.guest_photo_ai_attempts(network_hash,created_at);
create index guest_ai_tenant_time on public.guest_photo_ai_attempts(tenant_id,created_at);
alter table public.guest_photo_ai_attempts enable row level security;
revoke all on public.guest_photo_ai_attempts from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate on public.guest_photo_ai_attempts
 for each statement execute function komisio_private.guard_support_write();
create trigger plan_gate before insert on public.guest_photo_ai_attempts for each row execute function komisio_private.plan_gate();
create trigger meter_guest_photo_ai after insert on public.guest_photo_ai_attempts for each row execute function komisio_private.meter_usage('reception_assistance');

create function public.guest_photo_ai_configuration(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare own jsonb;
begin
 perform komisio_private.require_seller_ai_server();
 if p_tenant is null or p_tenant is distinct from (public.public_central_app_recipient()->>'id')::uuid then raise exception 'STORE_UNAVAILABLE'; end if;
 if komisio_private.current_store_policy_core(p_tenant)#>>'{policy,assistanceEnabled}' is distinct from 'true' then raise exception 'ASSISTANCE_DISABLED'; end if;
 select jsonb_build_object('model',model,'cipher',cipher) into own from public.ai_connections where tenant_id=p_tenant;
 return jsonb_build_object('own',own);
end $$;

create function public.read_guest_photo_analysis(p_id uuid,p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.guest_photo_ai_attempts;
begin
 perform komisio_private.require_seller_ai_server();
 select * into a from public.guest_photo_ai_attempts where id=p_id and token_hash=p_token_hash;
 if not found then return null; end if;
 if a.created_at<=clock_timestamp()-interval '24 hours' then raise exception 'GUEST_ANALYSIS_EXPIRED'; end if;
 return jsonb_build_object('id',a.id,'tenantId',a.tenant_id,'photos',a.photos,'language',a.language,
  'status',case when a.completed_at is null then 'pending' when a.output is null then 'failed' else 'ready' end,
  'output',a.output-'estimatedWeightG');
end $$;

create function public.begin_guest_photo_analysis(p_id uuid,p_tenant uuid,p_token_hash text,p_network_hash text,p_input_hash text,p_photos uuid[],p_language text,p_model text,p_started_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.guest_photo_ai_attempts; settings public.platform_settings;
 period text; est bigint; inc bigint; pur bigint; fund text;
begin
 perform komisio_private.require_seller_ai_server();
 if p_id is null or p_tenant is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
  or p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$' or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it')
  or p_photos is null or cardinality(p_photos) not between 1 and 8 or array_ndims(p_photos)<>1 or array_lower(p_photos,1)<>1
  or (select count(distinct x) from unnest(p_photos) x)<>cardinality(p_photos)
  or p_started_at is null or not isfinite(p_started_at) or p_started_at>clock_timestamp()+interval '5 minutes'
 then raise exception 'INVALID_INPUT'; end if;
 if p_started_at<=clock_timestamp()-interval '24 hours' then raise exception 'GUEST_ANALYSIS_EXPIRED'; end if;
 -- Use the same lock order as authenticated analysis: intake, tenant, budget.
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 select * into a from public.guest_photo_ai_attempts where id=p_id;
 if found then
  if a.token_hash<>p_token_hash or a.tenant_id<>p_tenant or a.input_hash<>p_input_hash or a.photos<>p_photos or a.language<>p_language then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('reserved',false,'result',public.read_guest_photo_analysis(p_id,p_token_hash));
 end if;
 perform public.guest_photo_ai_configuration(p_tenant);
 if exists(select 1 from public.guest_photo_ai_attempts where token_hash=p_token_hash and created_at>clock_timestamp()-interval '20 seconds')
  or (select count(*) from public.guest_photo_ai_attempts where token_hash=p_token_hash and created_at>clock_timestamp()-interval '24 hours')>=10
  or (select count(*) from public.guest_photo_ai_attempts where network_hash=p_network_hash and created_at>clock_timestamp()-interval '24 hours')>=20
  or (select count(*) from public.guest_photo_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')
   +(select count(*) from public.external_photo_ai_attempts where tenant_id=p_tenant and guest_analysis_id is null and created_at>clock_timestamp()-interval '24 hours')>=100
 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.guest_photo_ai_attempts(id,tenant_id,token_hash,network_hash,input_hash,photos,language,model)
 values(p_id,p_tenant,p_token_hash,p_network_hash,p_input_hash,p_photos,p_language,p_model);
 perform 1 from public.platform_settings for update;
 settings:=komisio_private.ai_settings();
 if settings.ai_credits_enabled and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then
  period:=komisio_private.usage_period(clock_timestamp()); est:=settings.ai_reserve_batch_ore;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,period);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED'; end if;
  if fund='included' and komisio_private.ai_cap_used(period)+est>settings.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model)
   values(p_tenant,'reserved',-est,fund,period,'guest-photo:'||p_id,p_model);
 end if;
 return jsonb_build_object('reserved',true,'result',public.read_guest_photo_analysis(p_id,p_token_hash));
end $$;

create function public.complete_guest_photo_analysis(p_id uuid,p_token_hash text,p_evidence jsonb,p_output jsonb,p_input integer,p_output_tokens integer) returns void
language plpgsql security definer set search_path='' as $$
declare a public.guest_photo_ai_attempts; reserved public.ai_credit_events; actual bigint;
begin
 perform komisio_private.require_seller_ai_server();
 select * into a from public.guest_photo_ai_attempts where id=p_id and token_hash=p_token_hash;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 select * into a from public.guest_photo_ai_attempts where id=p_id and token_hash=p_token_hash for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if a.completed_at is not null then
  if a.output is distinct from p_output or a.evidence is distinct from p_evidence or a.input_tokens is distinct from p_input or a.output_tokens is distinct from p_output_tokens then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 if p_input is null or p_input not between 0 and 10000000 or p_output_tokens is null or p_output_tokens not between 0 and 10000000
  or jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)>cardinality(a.photos)
  or exists(select 1 from jsonb_array_elements(p_evidence) e where jsonb_typeof(e)<>'string' or (e#>>'{}') !~ '^[a-f0-9]{64}$')
 then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null then
  if jsonb_array_length(p_evidence)<>cardinality(a.photos)
   or jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['description','brand','condition','notes','estimatedWeightG'])
   or p_output-array['description','brand','condition','notes','estimatedWeightG']<>'{}'::jsonb
   or jsonb_typeof(p_output->'description') is distinct from 'string' or length(trim(p_output->>'description')) not between 1 and 160
   or (p_output->'brand'<>'null'::jsonb and (jsonb_typeof(p_output->'brand') is distinct from 'string' or length(trim(p_output->>'brand')) not between 1 and 100))
   or (p_output->'condition'<>'null'::jsonb and (jsonb_typeof(p_output->'condition') is distinct from 'string' or p_output->>'condition' not in ('like_new','very_good','good','worn')))
   or jsonb_typeof(p_output->'notes') is distinct from 'string' or length(p_output->>'notes')>1000
   or (p_output->'estimatedWeightG'<>'null'::jsonb and not(case
    when jsonb_typeof(p_output->'estimatedWeightG')='number' and (p_output->>'estimatedWeightG') ~ '^[1-9][0-9]{0,5}$'
    then (p_output->>'estimatedWeightG')::integer<=100000 else false end))
  then raise exception 'INVALID_INPUT'; end if;
 end if;
 select * into reserved from public.ai_credit_events where tenant_id=a.tenant_id and reference='guest-photo:'||p_id and kind='reserved';
 if found then
  actual:=komisio_private.ai_cost_ore(p_input,p_output_tokens);
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,input_tokens,output_tokens)
   values(a.tenant_id,'settled',-reserved.amount_ore-actual,reserved.funded_by,reserved.period,reserved.reference,reserved.model,p_input,p_output_tokens);
 end if;
 update public.guest_photo_ai_attempts set completed_at=clock_timestamp(),evidence=p_evidence,output=p_output,input_tokens=p_input,output_tokens=p_output_tokens where id=p_id;
end $$;

-- Authenticated adoption copies trusted, matching evidence before guest expiry.
-- No FK to the temporary source: immutable owned evidence survives its cleanup.
alter table public.external_photo_ai_attempts add column guest_analysis_id uuid unique;
drop trigger meter_external_photo_ai on public.external_photo_ai_attempts;
create trigger meter_external_photo_ai after insert on public.external_photo_ai_attempts for each row
 when(new.guest_analysis_id is null) execute function komisio_private.meter_usage('reception_assistance');
create function public.adopt_guest_photo_analysis(p_id uuid,p_token_hash text,p_tenant uuid,p_photos uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; a public.guest_photo_ai_attempts; prior public.external_photo_ai_attempts; hashes jsonb; evidence jsonb; copied uuid;
begin
 perform komisio_private.require_seller_ai_server();
 uid:=komisio_private.external_identity_owner();
 perform komisio_private.lock_external_owner(uid);
 perform 1 from public.tenants where id=p_tenant for update;
 select * into a from public.guest_photo_ai_attempts where id=p_id and token_hash=p_token_hash and tenant_id=p_tenant;
 if not found or a.output is null or a.completed_at is null or a.created_at<=clock_timestamp()-interval '24 hours' then return null; end if;
 if p_tenant is distinct from (public.public_central_app_recipient()->>'id')::uuid then raise exception 'STORE_UNAVAILABLE'; end if;
 if p_photos is null or cardinality(p_photos)<>cardinality(a.photos) then return null; end if;
 select jsonb_agg(p.sha256 order by u.n),jsonb_agg(jsonb_build_object('id',p.id,'path',p.path,'sha256',p.sha256) order by u.n) into hashes,evidence
 from unnest(p_photos) with ordinality u(id,n) join public.external_item_photos p on p.id=u.id
 where p.owner_id=uid and p.discarded_at is null and p.content_verified_at is not null
  and exists(select 1 from storage.objects o where o.bucket_id='external-item-photos' and o.name=p.path);
 if hashes is distinct from a.evidence then return null; end if;
 select * into prior from public.external_photo_ai_attempts where guest_analysis_id=p_id;
 if found then
  if prior.owner_id<>uid or prior.tenant_id<>p_tenant then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return prior.id;
 end if;
 copied:=komisio_private.derived_id('guest-photo:'||p_id);
 insert into public.external_photo_ai_attempts(id,tenant_id,owner_id,photos,evidence,language,model,prompt_version,guest_analysis_id)
 values(copied,p_tenant,uid,p_photos,evidence,a.language,a.model,'central-photo-v2-weight',p_id);
 insert into public.external_photo_ai_results(id,tenant_id,output,input_tokens,output_tokens)
 values(copied,p_tenant,a.output,0,0);
 return copied;
end $$;

-- The quota counts calls, not copied evidence. Both API generations share it.
do $$ declare definition text; needle text:='(select count(*) from public.external_photo_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval ''24 hours'')>=100'; begin
 definition:=pg_get_functiondef('public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text,text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_AI_LIMIT'; end if;
 execute replace(definition,needle,'(select count(*) from public.external_photo_ai_attempts where tenant_id=p_tenant and guest_analysis_id is null and created_at>clock_timestamp()-interval ''24 hours'')
  +(select count(*) from public.guest_photo_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval ''24 hours'')>=100');
end $$;

create function public.prune_guest_photo_analyses() returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 perform komisio_private.require_seller_ai_server();
 delete from public.guest_photo_ai_attempts where id in
  (select id from public.guest_photo_ai_attempts where created_at<=clock_timestamp()-interval '24 hours' order by created_at limit 500);
 get diagnostics removed=row_count;
 return removed;
end $$;
revoke all on function public.guest_photo_ai_configuration(uuid),public.read_guest_photo_analysis(uuid,text),public.begin_guest_photo_analysis(uuid,uuid,text,text,text,uuid[],text,text,timestamptz),public.complete_guest_photo_analysis(uuid,text,jsonb,jsonb,integer,integer),public.prune_guest_photo_analyses() from public,anon,authenticated;
grant execute on function public.guest_photo_ai_configuration(uuid),public.read_guest_photo_analysis(uuid,text),public.begin_guest_photo_analysis(uuid,uuid,text,text,text,uuid[],text,text,timestamptz),public.complete_guest_photo_analysis(uuid,text,jsonb,jsonb,integer,integer),public.prune_guest_photo_analyses() to anon,authenticated;
revoke all on function public.adopt_guest_photo_analysis(uuid,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.adopt_guest_photo_analysis(uuid,text,uuid,uuid[]) to authenticated;
