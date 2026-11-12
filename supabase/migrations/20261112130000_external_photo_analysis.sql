-- User-owned draft analysis is separate from store sellers and submitted requests.
create table public.external_photo_ai_attempts (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 owner_id uuid not null references auth.users(id),
 photos uuid[] not null check(cardinality(photos) between 1 and 8),
 evidence jsonb not null,
 language text not null check(language in ('sv','en','no','dk','fi','de','es','it')),
 model text not null,
 prompt_version text not null default 'central-photo-v1',
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id)
);
create table public.external_photo_ai_results (
 id uuid primary key,
 tenant_id uuid not null,
 output jsonb,
 input_tokens integer not null check(input_tokens between 0 and 10000000),
 output_tokens integer not null check(output_tokens between 0 and 10000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,id) references public.external_photo_ai_attempts(tenant_id,id)
);
create index external_photo_ai_owner on public.external_photo_ai_attempts(owner_id,created_at desc);
create index external_photo_ai_tenant on public.external_photo_ai_attempts(tenant_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['external_photo_ai_attempts','external_photo_ai_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function komisio_private.preserve_operation()',t);
  execute format('create trigger support_read_only_guard before insert or update or delete or truncate on public.%I for each statement execute function komisio_private.guard_support_write()',t);
 end loop;
end $$;
create trigger plan_gate before insert on public.external_photo_ai_attempts for each row execute function komisio_private.plan_gate();
create trigger meter_external_photo_ai after insert on public.external_photo_ai_attempts for each row execute function komisio_private.meter_usage('reception_assistance');

create function public.my_external_photo_analysis(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=komisio_private.external_phone_owner(); a public.external_photo_ai_attempts; r public.external_photo_ai_results;
begin
 select * into a from public.external_photo_ai_attempts where id=p_id and owner_id=uid;
 if not found then return null; end if;
 select * into r from public.external_photo_ai_results where id=p_id;
 return jsonb_build_object('id',a.id,'tenantId',a.tenant_id,'photos',a.photos,'language',a.language,
  'status',case when not found then 'pending' when r.output is null then 'failed' else 'ready' end,'output',r.output);
end $$;

create function public.external_photo_ai_configuration(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare own jsonb;
begin
 perform komisio_private.require_seller_ai_server();
 perform komisio_private.external_phone_owner();
 if p_tenant is null or p_tenant is distinct from (public.public_central_app_recipient()->>'id')::uuid then raise exception 'STORE_UNAVAILABLE'; end if;
 if komisio_private.current_store_policy_core(p_tenant)#>>'{policy,assistanceEnabled}' is distinct from 'true' then raise exception 'ASSISTANCE_DISABLED'; end if;
 select jsonb_build_object('model',model,'cipher',cipher) into own from public.ai_connections where tenant_id=p_tenant;
 return jsonb_build_object('own',own);
end $$;

create function public.begin_external_photo_analysis(p_id uuid,p_tenant uuid,p_photos uuid[],p_model text,p_language text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; a public.external_photo_ai_attempts; evidence jsonb; settings public.platform_settings;
 period text; est bigint; inc bigint; pur bigint; fund text;
begin
 perform komisio_private.require_seller_ai_server();
 uid:=komisio_private.external_phone_owner();
 if p_id is null or p_tenant is null or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$'
  or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it')
  or p_photos is null or cardinality(p_photos) not between 1 and 8 or array_ndims(p_photos)<>1 or array_lower(p_photos,1)<>1
  or (select count(distinct x) from unnest(p_photos) x)<>cardinality(p_photos)
 then raise exception 'INVALID_INPUT'; end if;
 perform komisio_private.lock_external_owner(uid);
 select * into a from public.external_photo_ai_attempts where id=p_id;
 if found then
  if a.owner_id<>uid or a.tenant_id<>p_tenant or a.photos<>p_photos or a.language<>p_language or a.model<>p_model then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('reserved',false,'result',public.my_external_photo_analysis(p_id),'evidence',a.evidence);
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('central-app-intake',0));
 perform 1 from public.tenants where id=p_tenant for update;
 perform public.external_photo_ai_configuration(p_tenant);
 select jsonb_agg(jsonb_build_object('id',p.id,'path',p.path,'sha256',p.sha256) order by u.n) into evidence
 from unnest(p_photos) with ordinality u(id,n) join public.external_item_photos p on p.id=u.id
 where p.owner_id=uid and p.discarded_at is null and exists(select 1 from storage.objects o where o.bucket_id='external-item-photos' and o.name=p.path);
 if coalesce(jsonb_array_length(evidence),0)<>cardinality(p_photos) then raise exception 'PHOTO_NOT_FOUND'; end if;
 if exists(select 1 from public.external_photo_ai_attempts where owner_id=uid and created_at>clock_timestamp()-interval '20 seconds')
  or (select count(*) from public.external_photo_ai_attempts where owner_id=uid and created_at>clock_timestamp()-interval '24 hours')>=10
  or (select count(*) from public.external_photo_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')>=100
 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.external_photo_ai_attempts(id,tenant_id,owner_id,photos,evidence,language,model) values(p_id,p_tenant,uid,p_photos,evidence,p_language,p_model);
 -- Share the existing tenant quota, credit funding and platform cap.
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
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by)
   values(p_tenant,'reserved',-est,fund,period,'external-photo:'||p_id,p_model,uid);
 end if;
 return jsonb_build_object('reserved',true,'result',public.my_external_photo_analysis(p_id),'evidence',evidence);
end $$;

create function public.complete_external_photo_analysis(p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid; a public.external_photo_ai_attempts; r public.external_photo_ai_results; reserved public.ai_credit_events; actual bigint;
begin
 perform komisio_private.require_seller_ai_server();
 uid:=komisio_private.external_phone_owner();
 perform komisio_private.lock_external_owner(uid);
 select * into a from public.external_photo_ai_attempts where id=p_id and owner_id=uid;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenants where id=a.tenant_id for update;
 if p_input is null or p_input not between 0 and 10000000 or p_output_tokens is null or p_output_tokens not between 0 and 10000000 then raise exception 'INVALID_INPUT'; end if;
 select * into r from public.external_photo_ai_results where id=p_id;
 if found then
  if r.output is distinct from p_output or r.input_tokens<>p_input or r.output_tokens<>p_output_tokens then raise exception 'REQUEST_CONFLICT'; end if;
  return;
 end if;
 if p_output is not null then
  if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['description','brand','condition','notes'])
   or p_output-array['description','brand','condition','notes']<>'{}'::jsonb
   or jsonb_typeof(p_output->'description') is distinct from 'string' or length(trim(p_output->>'description')) not between 1 and 160
   or (p_output->'brand'<>'null'::jsonb and (jsonb_typeof(p_output->'brand') is distinct from 'string' or length(trim(p_output->>'brand')) not between 1 and 100))
   or (p_output->'condition'<>'null'::jsonb and (jsonb_typeof(p_output->'condition') is distinct from 'string' or p_output->>'condition' not in ('like_new','very_good','good','worn')))
   or jsonb_typeof(p_output->'notes') is distinct from 'string' or length(p_output->>'notes')>1000
  then raise exception 'INVALID_INPUT'; end if;
 end if;
 select * into reserved from public.ai_credit_events where tenant_id=a.tenant_id and reference='external-photo:'||p_id and kind='reserved';
 if found then
  actual:=komisio_private.ai_cost_ore(p_input,p_output_tokens);
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,input_tokens,output_tokens,recorded_by)
   values(a.tenant_id,'settled',-reserved.amount_ore-actual,reserved.funded_by,reserved.period,reserved.reference,reserved.model,p_input,p_output_tokens,uid);
 end if;
 insert into public.external_photo_ai_results(id,tenant_id,output,input_tokens,output_tokens) values(p_id,a.tenant_id,p_output,p_input,p_output_tokens);
end $$;

revoke all on function public.my_external_photo_analysis(uuid),public.external_photo_ai_configuration(uuid),public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text),public.complete_external_photo_analysis(uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.my_external_photo_analysis(uuid),public.external_photo_ai_configuration(uuid),public.begin_external_photo_analysis(uuid,uuid,uuid[],text,text),public.complete_external_photo_analysis(uuid,jsonb,integer,integer) to authenticated;
