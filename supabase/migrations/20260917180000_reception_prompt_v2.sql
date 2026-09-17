-- The reception prompt reaches version two (2026-09-17). The attempt record
-- stores the version, so the reservation has to accept it or the assistant
-- cannot run at all. Version one stays valid: attempts already recorded under
-- it are history and are not rewritten.
--
-- What changed in the prompt: the model is asked for an item type and for the
-- attributes that type asks about, instead of seven fixed fields. A lamp can
-- describe its socket; a garment answers exactly as before.

create or replace function public.reserve_reception_assistance(p_tenant uuid,p_request uuid,p_session uuid,p_revision integer,p_model text,p_prompt text) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.reception_assistance_attempts; latest integer; moment timestamptz; s public.platform_settings; est bigint; p text; inc bigint; pur bigint; fund text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_request is null or p_session is null or p_revision is null or p_revision<1
  or p_model is null or p_model !~ '^[a-zA-Z0-9._:-]{1,100}$' or (p_prompt is null or p_prompt not in ('reception-v1','reception-v2','reception-batch-v1')) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.reception_assistance_attempts where id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.session_id is distinct from p_session or prior.source_revision is distinct from p_revision
   or prior.created_by is distinct from uid or prior.model is distinct from p_model or prior.prompt_version is distinct from p_prompt then raise exception 'REQUEST_CONFLICT'; end if;
  return false;
 end if;
 select revision into latest from public.reception_source_revisions where tenant_id=p_tenant and session_id=p_session order by revision desc limit 1;
 if latest is distinct from p_revision then raise exception 'RECEPTION_CHANGED'; end if;
 moment:=clock_timestamp();
 if exists(select 1 from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '20 seconds')
  or (select count(*) from public.reception_assistance_attempts where tenant_id=p_tenant and created_at>moment-interval '24 hours')>=10 then raise exception 'ASSISTANCE_LIMIT'; end if;
 insert into public.reception_assistance_attempts(id,tenant_id,session_id,source_revision,created_by,model,prompt_version,created_at)
 values(p_request,p_tenant,p_session,p_revision,uid,p_model,p_prompt,moment);
 s:=komisio_private.ai_settings();
 if s.ai_credits_enabled and not exists(select 1 from public.ai_connections c where c.tenant_id=p_tenant) then
  p:=komisio_private.usage_period(moment);
  est:=case when p_prompt='reception-batch-v1' then s.ai_reserve_batch_ore else s.ai_reserve_ore end;
  perform komisio_private.ai_grant_included(p_tenant);
  select included_left,purchased_left into inc,pur from komisio_private.ai_balances(p_tenant,p);
  if inc>=est then fund:='included'; elsif pur>=est then fund:='purchased'; else raise exception 'AI_CREDITS_EXHAUSTED' using errcode='55000'; end if;
  if fund='included' and komisio_private.ai_cap_used(p)+est>s.ai_monthly_cap_ore then
   if pur>=est then fund:='purchased'; else raise exception 'AI_CAP_REACHED' using errcode='55000'; end if;
  end if;
  insert into public.ai_credit_events(tenant_id,kind,amount_ore,funded_by,period,reference,model,recorded_by) values(p_tenant,'reserved',-est,fund,p,'attempt:'||p_request,p_model,uid);
 end if;
 perform komisio_private.record_access(p_tenant,'reception.assistance_reserved',p_session,jsonb_build_object('request',p_request,'source_revision',p_revision));
 return true;
end $$;
