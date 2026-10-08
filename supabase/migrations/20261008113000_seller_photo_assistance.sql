-- Only the authenticated seller AND the server capability may run/complete AI.
-- Provision the verifier separately; no deployment secret is part of migrations.
create table komisio_private.seller_ai_runtime (
 singleton boolean primary key default true check(singleton),
 key_hash text not null check(key_hash ~ '^[0-9a-f]{64}$')
);
revoke all on komisio_private.seller_ai_runtime from public,anon,authenticated;
create function komisio_private.require_seller_ai_server() returns void
language plpgsql stable security definer set search_path='' as $$
declare token text:=coalesce(current_setting('request.headers',true)::jsonb->>'x-komisio-seller-ai','');
begin
 if length(token)<>64 or not exists(select 1 from komisio_private.seller_ai_runtime where key_hash=encode(extensions.digest(token,'sha256'),'hex')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function komisio_private.require_seller_ai_server() from public,anon,authenticated;

create table public.seller_ai_attempts (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),seller_id uuid not null,
 photos jsonb not null,context jsonb not null,model text not null,prompt_version text not null default 'seller-photo-v1',
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id)
);
create table public.seller_ai_results (
 id uuid primary key,tenant_id uuid not null,output jsonb,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,id) references public.seller_ai_attempts(tenant_id,id)
);
alter table public.seller_ai_attempts enable row level security;
alter table public.seller_ai_results enable row level security;
revoke all on public.seller_ai_attempts,public.seller_ai_results from public,anon,authenticated;
create trigger seller_ai_attempts_immutable before update or delete on public.seller_ai_attempts for each row execute function komisio_private.preserve_operation();
create trigger seller_ai_results_immutable before update or delete on public.seller_ai_results for each row execute function komisio_private.preserve_operation();
create trigger meter_seller_assistance after insert on public.seller_ai_attempts for each row execute function komisio_private.meter_usage('reception_assistance');

create function public.seller_ai_configuration(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pol jsonb; own jsonb;
begin
 perform komisio_private.require_seller_ai_server();
 perform komisio_private.require_seller(p_tenant,p_seller);
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 if pol->>'assistanceEnabled' is distinct from 'true' then raise exception 'ASSISTANCE_DISABLED'; end if;
 select jsonb_build_object('model',model,'cipher',cipher) into own from public.ai_connections where tenant_id=p_tenant;
 return jsonb_build_object('own',own);
end $$;

create function public.begin_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_photos jsonb,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_ai_attempts; res public.seller_ai_results; pol jsonb; profile jsonb; goods jsonb; evidence jsonb; snapshot jsonb; path text;
 settings public.platform_settings; period text; est bigint; inc bigint; pur bigint; fund text;
begin
 perform komisio_private.require_seller_ai_server();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_photos) not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string') or (select count(distinct x) from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_ai_attempts where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.created_by<>uid or prior.photos<>p_photos or prior.model<>p_model then raise exception 'REQUEST_CONFLICT'; end if;
  select * into res from public.seller_ai_results where id=p_id;
  return jsonb_build_object('reserved',false,'status',case when not found then 'pending' when res.output is null then 'failed' else 'ready' end,'output',res.output,'context',prior.context);
 end if;
 pol:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 if pol->>'assistanceEnabled' is distinct from 'true' then raise exception 'ASSISTANCE_DISABLED'; end if;
 if exists(select 1 from public.seller_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '20 seconds') or (select count(*) from public.seller_ai_attempts where tenant_id=p_tenant and created_at>clock_timestamp()-interval '24 hours')>=100 then raise exception 'ASSISTANCE_LIMIT'; end if;
 for path in select jsonb_array_elements_text(p_photos) loop
  if path not like p_tenant::text||'/'||p_seller::text||'/%' or not public.seller_submission_photo_access(path,true) or not exists(select 1 from storage.objects where bucket_id='seller-submission-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 end loop;
 select v.profile into profile from public.store_profile_versions v where tenant_id=p_tenant order by version desc limit 1;
 select answers->'goods' into goods from public.store_guide_versions where tenant_id=p_tenant order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into evidence from (
  select l.id,komisio_private.item_title(p_tenant,l.item_id) as facts,(l.price_ore::numeric/100)::numeric(12,2)::text as amount,s.occurred_at as sold_at
  from public.sale_lines l join public.sales s on s.id=l.sale_id and s.tenant_id=l.tenant_id
  join public.items i on i.id=l.item_id and i.tenant_id=l.tenant_id
  where l.tenant_id=p_tenant and s.status='completed' and i.ownership='consignment'
   and s.currency=komisio_private.store_currency(p_tenant) and s.occurred_at>=now()-interval '365 days'
   and not exists(select 1 from public.sale_returns r where r.tenant_id=p_tenant and r.sale_line_id=l.id)
  order by s.occurred_at desc,l.id limit 20
 ) x;
 snapshot:=jsonb_build_object('language',coalesce(pol->>'itemLanguage','sv'),'currency',komisio_private.store_currency(p_tenant),'country',profile->'address'->>'country','accepts',coalesce(profile->>'accepts',''),'concept',coalesce(profile->>'concept',''),'goods',coalesce(goods,'[]'),'evidence',evidence);
 insert into public.seller_ai_attempts(id,tenant_id,seller_id,photos,context,model,created_by) values(p_id,p_tenant,p_seller,p_photos,snapshot,p_model,uid);
 perform 1 from public.platform_settings for update;
 settings:=komisio_private.ai_settings();
 if settings.ai_credits_enabled and not exists(select 1 from public.ai_connections where tenant_id=p_tenant) then
  period:=komisio_private.usage_period(clock_timestamp());est:=settings.ai_reserve_batch_ore;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,period);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED'; end if;
  if fund='included' and komisio_private.ai_cap_used(period)+est>settings.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,period,'seller-photo:'||p_id,p_model,uid);
 end if;
 return jsonb_build_object('reserved',true,'status','pending','output',null,'context',snapshot);
end $$;

create function public.complete_seller_photo_assistance(p_tenant uuid,p_seller uuid,p_id uuid,p_output jsonb,p_input integer,p_output_tokens integer) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid; attempt public.seller_ai_attempts; prior public.seller_ai_results; reserved public.ai_credit_events; actual bigint; low numeric; high numeric;
begin
 perform komisio_private.require_seller_ai_server();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 select * into attempt from public.seller_ai_attempts where id=p_id and tenant_id=p_tenant and seller_id=p_seller and created_by=uid;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into prior from public.seller_ai_results where id=p_id;
 if found then if prior.output is distinct from p_output then raise exception 'REQUEST_CONFLICT'; end if; return; end if;
 if p_input is null or p_output_tokens is null or p_input not between 0 and 10000000 or p_output_tokens not between 0 and 10000000 then raise exception 'INVALID_INPUT'; end if;
 if p_output is not null then
  if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['description','price','suitability','reason']) or p_output-array['description','price','suitability','reason']<>'{}'::jsonb
   or jsonb_typeof(p_output->'description') is distinct from 'string' or length(trim(p_output->>'description')) not between 1 and 2000
   or jsonb_typeof(p_output->'reason') is distinct from 'string' or length(trim(p_output->>'reason')) not between 1 and 300
   or coalesce(p_output->>'suitability','') not in ('likely','uncertain','unlikely') then raise exception 'INVALID_INPUT'; end if;
  if trim(attempt.context->>'accepts')='' and trim(attempt.context->>'concept')='' and attempt.context->'goods'='[]'::jsonb and p_output->>'suitability'<>'uncertain' then raise exception 'INVALID_INPUT'; end if;
  if p_output->'price'<>'null'::jsonb then
   if jsonb_typeof(p_output->'price') is distinct from 'object' or not(p_output->'price' ?& array['from','to','evidenceIds']) or (p_output->'price')-array['from','to','evidenceIds']<>'{}'::jsonb
    or jsonb_typeof(p_output->'price'->'from') is distinct from 'string' or jsonb_typeof(p_output->'price'->'to') is distinct from 'string'
    or coalesce(p_output->'price'->>'from','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$' or coalesce(p_output->'price'->>'to','') !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{2}$'
    or jsonb_typeof(p_output->'price'->'evidenceIds') is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
   low:=(p_output->'price'->>'from')::numeric;high:=(p_output->'price'->>'to')::numeric;
   if low<=0 or high<low or jsonb_array_length(p_output->'price'->'evidenceIds') not between 1 and 20 or exists(select 1 from jsonb_array_elements_text(p_output->'price'->'evidenceIds') e where not exists(select 1 from jsonb_array_elements(attempt.context->'evidence') x where x->>'id'=e)) then raise exception 'INVALID_INPUT'; end if;
  end if;
 end if;
 select * into reserved from public.ai_credit_events where tenant_id=p_tenant and reference='seller-photo:'||p_id and kind='reserved';
 if found then
  actual:=komisio_private.ai_cost_ore(p_input,p_output_tokens);
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,input_tokens,output_tokens,recorded_by) values(p_tenant,'settled',-reserved.amount_ore-actual,reserved.funded_by,reserved.period,reserved.reference,reserved.model,p_input,p_output_tokens,uid);
 end if;
 insert into public.seller_ai_results(id,tenant_id,output) values(p_id,p_tenant,p_output);
 perform komisio_private.record_access(p_tenant,'seller_submission.assistance_completed',p_id,jsonb_build_object('ready',p_output is not null));
end $$;
revoke all on function public.seller_ai_configuration(uuid,uuid),public.begin_seller_photo_assistance(uuid,uuid,uuid,jsonb,text),public.complete_seller_photo_assistance(uuid,uuid,uuid,jsonb,integer,integer) from public,anon;
grant execute on function public.seller_ai_configuration(uuid,uuid),public.begin_seller_photo_assistance(uuid,uuid,uuid,jsonb,text),public.complete_seller_photo_assistance(uuid,uuid,uuid,jsonb,integer,integer) to authenticated;

alter table public.seller_submissions add column assistance_id uuid, add column assistance_output jsonb,
 add foreign key(tenant_id,assistance_id) references public.seller_ai_attempts(tenant_id,id);
create function public.submit_my_assisted_items(p_tenant uuid,p_id uuid,p_seller uuid,p_previous uuid,p_description text,p_photos jsonb,p_assistance uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_submissions; path text; d text:=trim(p_description);
begin
 if p_assistance is not null and not exists(select 1 from public.seller_ai_attempts a join public.seller_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id where a.id=p_assistance and a.tenant_id=p_tenant and a.seller_id=p_seller and a.photos=p_photos and r.output is not null) then raise exception 'INVALID_INPUT'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or d is null or length(d) not between 1 and 2000 or p_photos is null or jsonb_typeof(p_photos)<>'array' then raise exception 'INVALID_INPUT'; end if;
 if jsonb_array_length(p_photos) not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string') then raise exception 'INVALID_INPUT'; end if;
 if (select count(distinct x) from jsonb_array_elements(p_photos) x)<>jsonb_array_length(p_photos) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_submissions where id=p_id;
 if found then
  if prior.assistance_id is distinct from p_assistance or prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.previous_id is distinct from p_previous or prior.description is distinct from d or prior.photos is distinct from p_photos or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_previous is not null and (not exists(select 1 from public.seller_submissions s join public.seller_submission_reviews r on r.submission_id=s.id where s.id=p_previous and s.tenant_id=p_tenant and s.seller_id=p_seller and r.decision='more_information') or exists(select 1 from public.seller_submissions where previous_id=p_previous)) then raise exception 'SUBMISSION_CHANGED'; end if;
 for path in select jsonb_array_elements_text(p_photos) loop
  if path not like p_tenant::text||'/'||p_seller::text||'/%' or not public.seller_submission_photo_access(path,true)
   or not exists(select 1 from storage.objects where bucket_id='seller-submission-photos' and name=path) then raise exception 'PHOTO_NOT_FOUND'; end if;
 end loop;
 insert into public.seller_submissions(id,tenant_id,seller_id,previous_id,description,photos,created_by,assistance_id,assistance_output)
 values(p_id,p_tenant,p_seller,p_previous,d,p_photos,uid,p_assistance,(select jsonb_build_object('suggestion',r.output,'currency',a.context->>'currency') from public.seller_ai_attempts a join public.seller_ai_results r on r.id=a.id and r.tenant_id=a.tenant_id where a.id=p_assistance));
 perform komisio_private.record_access(p_tenant,'seller_submission.sent',p_id,'{}');
 return p_id;
end $$;

revoke all on function public.submit_my_assisted_items(uuid,uuid,uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.submit_my_assisted_items(uuid,uuid,uuid,uuid,text,jsonb,uuid) to authenticated;
