-- Keep the selected application language separate from the accepted agreement's language.
alter table public.seller_registrations add column application_locale text
 check(application_locale in ('sv','en','no','dk','fi','de','es','it'));
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.submit_seller_registration(text,uuid,text,text,uuid,uuid,boolean,uuid)'::regprocedure);
 if position('p_mail_setting uuid DEFAULT NULL::uuid)' in definition)=0
  or position('mail_setting_id,agreement_text)' in definition)=0
  or position('translation.id,mail_setting,' in definition)=0 then raise exception 'UNEXPECTED_REGISTRATION_DEFINITION'; end if;
 definition:=replace(definition,'FUNCTION public.submit_seller_registration(','FUNCTION public.submit_seller_registration_in_language(');
 definition:=replace(definition,'p_mail_setting uuid DEFAULT NULL::uuid)','p_mail_setting uuid, p_locale text)');
 definition:=replace(definition,E'begin\n',E'begin\n if p_locale is not null and p_locale not in (''sv'',''en'',''no'',''dk'',''fi'',''de'',''es'',''it'') then raise exception ''INVALID_INPUT''; end if;\n');
 definition:=replace(definition,'mail_setting_id,agreement_text)','mail_setting_id,application_locale,agreement_text)');
 definition:=replace(definition,'translation.id,mail_setting,','translation.id,mail_setting,p_locale,');
 execute definition;
end $$;
-- Older clients retain their contract and store no guessed application language.
create or replace function public.submit_seller_registration(p_token text,p_id uuid,p_name text,p_phone text,p_agreement uuid,p_translation uuid,p_accepted boolean,p_mail_setting uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select public.submit_seller_registration_in_language(p_token,p_id,p_name,p_phone,p_agreement,p_translation,p_accepted,p_mail_setting,null)
$$;
revoke all on function public.submit_seller_registration_in_language(text,uuid,text,text,uuid,uuid,boolean,uuid,text) from public,anon;
grant execute on function public.submit_seller_registration_in_language(text,uuid,text,text,uuid,uuid,boolean,uuid,text) to authenticated;

-- A committed communication row is the durable, single-attempt delivery claim.
alter table public.seller_communications add column registration_review_id uuid unique references public.seller_registration_reviews(id);
alter table public.seller_communications add constraint registration_approval_template
 check(registration_review_id is null or (kind='message' and template_key='seller.registration_approved' and template_version='v1' and reference_kind='none'));
create function komisio_private.preserve_registration_notice() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.registration_review_id is distinct from old.registration_review_id then raise exception 'IMMUTABLE_COMMUNICATION' using errcode='55000'; end if;
 return new;
end $$;
revoke all on function komisio_private.preserve_registration_notice() from public,anon,authenticated;
create trigger preserve_registration_notice before update on public.seller_communications
 for each row execute function komisio_private.preserve_registration_notice();

create function public.registration_approval_notice(p_tenant uuid,p_review uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare review public.seller_registration_reviews; application public.seller_registrations; seller public.sellers; profile jsonb; policy jsonb; locale text; store_name text;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into review from public.seller_registration_reviews where tenant_id=p_tenant and id=p_review and approved;
 if not found then return null; end if;
 if exists(select 1 from public.seller_communications where registration_review_id=p_review) then return null; end if;
 select * into application from public.seller_registrations where tenant_id=p_tenant and id=review.registration_id;
 select * into seller from public.sellers where tenant_id=p_tenant and id=review.seller_id and privacy_closed_at is null;
 if seller.id is null or application.email='' or lower(trim(seller.email)) is distinct from application.email
  or not exists(select 1 from auth.users where id=application.user_id and email_confirmed_at is not null and deleted_at is null and lower(trim(email))=application.email)
 then return null; end if;
 select v.profile into profile from public.store_profile_versions v where tenant_id=p_tenant order by version desc limit 1;
 policy:=komisio_private.current_store_policy_core(p_tenant)->'policy';
 locale:=coalesce(application.application_locale,profile->>'language',policy->>'communicationLanguage','en');
 if locale not in ('sv','en','no','dk','fi','de','es','it') then locale:='en'; end if;
 select name into store_name from public.tenants where id=p_tenant;
 return jsonb_build_object('tenantId',p_tenant,'reviewId',review.id,'sellerId',seller.id,
  'recipient',application.email,'locale',locale,'storeName',store_name,'sellerName',seller.name);
end $$;

create function public.claim_registration_approval_notice(p_id uuid,p_facts jsonb,p_locale text,p_subject text,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); tenant uuid; review uuid; facts jsonb;
begin
 if p_id is null or p_facts is null or jsonb_typeof(p_facts)<>'object' or octet_length(p_facts::text)>8000
  or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it')
  or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 8000 then raise exception 'INVALID_INPUT'; end if;
 tenant:=(p_facts->>'tenantId')::uuid; review:=(p_facts->>'reviewId')::uuid;
 perform 1 from public.tenants where id=tenant for update;
 facts:=public.registration_approval_notice(tenant,review);
 if facts is null or facts is distinct from p_facts then return null; end if;
 if not exists(select 1 from public.seller_registration_reviews where id=review and tenant_id=tenant and created_by=uid) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_locale<>facts->>'locale' and p_locale<>'en' then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from public.seller_communications c where c.tenant_id=tenant and c.queued_at>now()-interval '1 day')
  >=(select case when t.created_at>now()-make_interval(days=>s.email_trust_days) then s.email_new_cap else s.email_daily_cap end
    from public.platform_settings s,public.tenants t where t.id=tenant) then raise exception 'EMAIL_DAILY_CAP' using errcode='55000'; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by,registration_review_id)
 values(p_id,tenant,(facts->>'sellerId')::uuid,'message','seller.registration_approved','v1',p_locale,facts->>'recipient',trim(p_subject),trim(p_body),'none',null,uid,review);
 perform komisio_private.record_access(tenant,'communication.queued',p_id,jsonb_build_object('seller_id',facts->>'sellerId','kind','message','registrationReviewId',review));
 return p_id;
end $$;
revoke all on function public.registration_approval_notice(uuid,uuid),public.claim_registration_approval_notice(uuid,jsonb,text,text,text) from public,anon;
grant execute on function public.registration_approval_notice(uuid,uuid),public.claim_registration_approval_notice(uuid,jsonb,text,text,text) to authenticated;
notify pgrst,'reload schema';
