-- Equivalent language texts share one immutable agreement version and its gates.
create table public.seller_agreement_translations (
 id uuid primary key,
 tenant_id uuid not null,
 agreement_id uuid not null,
 language text not null check(language in ('sv','en','no','dk','fi','de','es','it')),
 title text not null check(length(trim(title)) between 1 and 120),
 body text not null check(length(trim(body)) between 1 and 12000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id),
 unique(tenant_id,agreement_id,language),
 unique(tenant_id,agreement_id,id)
);
alter table public.seller_agreement_translations enable row level security;
create policy agreement_translation_read on public.seller_agreement_translations for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.seller_agreement_translations from public,anon,authenticated;
grant select on public.seller_agreement_translations to authenticated;
create trigger immutable_agreement_translation before update or delete on public.seller_agreement_translations
 for each row execute function komisio_private.preserve_agreement_record();
alter table public.seller_agreement_evidence add column translation_id uuid,
 add foreign key(tenant_id,agreement_id,translation_id) references public.seller_agreement_translations(tenant_id,agreement_id,id);

create function public.publish_agreement_translation(p_tenant uuid,p_id uuid,p_agreement uuid,p_title text,p_body text,p_language text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_agreement_translations;
 current_version public.seller_agreement_versions; t text:=trim(p_title); b text:=trim(p_body);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_agreement is null or t is null or length(t) not between 1 and 120 or b is null or length(b) not between 1 and 12000
  or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_agreement_translations where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.agreement_id is distinct from p_agreement or prior.created_by is distinct from uid
   or prior.title is distinct from t or prior.body is distinct from b or prior.language is distinct from p_language then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is null or current_version.id is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if current_version.language=p_language or exists(select 1 from public.seller_agreement_translations where tenant_id=p_tenant and agreement_id=p_agreement and language=p_language) then raise exception 'INVALID_INPUT'; end if;
 insert into public.seller_agreement_translations(id,tenant_id,agreement_id,language,title,body,created_by)
 values(p_id,p_tenant,p_agreement,p_language,t,b,uid);
 perform komisio_private.record_access(p_tenant,'agreement.translation_published',p_id,jsonb_build_object('agreementId',p_agreement,'language',p_language));
 return p_id;
end $$;

create function public.record_agreement_evidence_text(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid,p_reference text,p_translation uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.seller_agreement_evidence; current_id uuid; r text:=trim(p_reference);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_agreement is null or r is null or length(r) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.seller_agreement_evidence where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.recorded_by is distinct from uid
  or previous.seller_id is distinct from p_seller or previous.agreement_id is distinct from p_agreement
  or previous.translation_id is distinct from p_translation or previous.source<>'staff_recorded' or previous.reference is distinct from r then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select id into current_id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_id is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_translation is not null and not exists(select 1 from public.seller_agreement_translations where tenant_id=p_tenant and agreement_id=p_agreement and id=p_translation) then raise exception 'INVALID_INPUT'; end if;
 insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,translation_id)
 values(p_id,p_tenant,p_agreement,p_seller,r,uid,p_translation);
 perform komisio_private.record_access(p_tenant,'agreement.evidence_recorded',p_id,jsonb_build_object('agreement_id',p_agreement));
 return p_id;
end $$;


create or replace function public.record_agreement_evidence(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid,p_reference text)
returns uuid language sql security invoker set search_path='' as $$
 select public.record_agreement_evidence_text(p_tenant,p_id,p_seller,p_agreement,p_reference,null);
$$;

create function public.accept_my_seller_agreement_text(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid,p_translation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_agreement_evidence; current_id uuid; address text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or p_agreement is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_agreement_evidence where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller
   or prior.agreement_id is distinct from p_agreement or prior.recorded_by is distinct from uid
   or prior.translation_id is distinct from p_translation or prior.source<>'seller_portal' then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.id;
 end if;
 select id into current_id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_id is null or current_id is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 if p_translation is not null and not exists(select 1 from public.seller_agreement_translations where tenant_id=p_tenant and agreement_id=p_agreement and id=p_translation) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=p_agreement and recorded_by=uid and source='seller_portal' and translation_id is not distinct from p_translation
 order by recorded_at,id limit 1;
 if found then return prior.id; end if;
 select lower(trim(email)) into address from auth.users where id=uid;
 insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by,source,translation_id)
 values(p_id,p_tenant,p_agreement,p_seller,address,uid,'seller_portal',p_translation);
 perform komisio_private.record_access(p_tenant,'agreement.accepted_by_seller',p_id,jsonb_build_object('agreementId',p_agreement,'sellerId',p_seller));
 return p_id;
end $$;

create or replace function public.accept_my_seller_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid)
returns uuid language sql security invoker set search_path='' as $$
 select public.accept_my_seller_agreement_text(p_tenant,p_id,p_seller,p_agreement,null);
$$;

create function public.save_seller_with_agreement_text(p_tenant uuid,p_id uuid,p_seller uuid,p_expected integer,p_profile jsonb,p_agreement uuid,p_reference text,p_translation uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_agreement is null or p_reference is null or length(trim(p_reference)) not between 1 and 500
  or ((p_seller is null)<>(p_expected is null)) then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.seller_profile_versions where id=p_id)
  and not exists(select 1 from public.seller_agreement_evidence where id=p_id) then raise exception 'REQUEST_CONFLICT'; end if;
 if p_seller is null then
  perform public.register_seller_with_profile(p_tenant,p_id,p_profile);
 else
  perform public.save_seller_profile(p_tenant,p_id,p_seller,p_expected,p_profile);
 end if;
 perform public.record_agreement_evidence_text(p_tenant,p_id,coalesce(p_seller,p_id),p_agreement,p_reference,p_translation);
 return p_id;
end $$;

create or replace function public.save_seller_with_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_expected integer,p_profile jsonb,p_agreement uuid,p_reference text)
returns uuid language sql security invoker set search_path='' as $$
 select public.save_seller_with_agreement_text(p_tenant,p_id,p_seller,p_expected,p_profile,p_agreement,p_reference,null);
$$;
-- Keep the existing authenticated archive boundary and add exact language reads.
-- NULL chooses the latest accepted text; the agreement id explicitly selects base.
create function public.my_seller_agreement_text(p_tenant uuid,p_seller uuid,p_version uuid,p_offset integer,p_text uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; agreement uuid; selected uuid; translated public.seller_agreement_translations; evidence public.seller_agreement_evidence; languages jsonb;
begin
 result:=public.my_seller_agreement_archive(p_tenant,p_seller,p_version,p_offset);
 agreement:=(result->'agreement'->>'id')::uuid;
 if agreement is null then return result||jsonb_build_object('languages','[]'::jsonb); end if;
 select * into evidence from public.seller_agreement_evidence where tenant_id=p_tenant and seller_id=p_seller and agreement_id=agreement order by recorded_at desc,id desc limit 1;
 selected:=coalesce(p_text,evidence.translation_id,agreement);
 if selected<>agreement then
  select * into translated from public.seller_agreement_translations where tenant_id=p_tenant and agreement_id=agreement and id=selected;
  if not found then raise exception 'AGREEMENT_NOT_FOUND'; end if;
  result:=jsonb_set(result,'{agreement}',(result->'agreement')||jsonb_build_object('title',translated.title,'body',translated.body,'language',translated.language));
 end if;
 result:=jsonb_set(result,'{agreement}',(result->'agreement')||jsonb_build_object('translationId',translated.id));
 if evidence.id is not null then
  result:=jsonb_set(result,'{acceptance}',(result->'acceptance')||jsonb_build_object('translationId',evidence.translation_id,
   'language',coalesce((select language from public.seller_agreement_translations where id=evidence.translation_id),(select language from public.seller_agreement_versions where id=agreement))));
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'language',language) order by language) into languages from (
  select a.id,a.language from public.seller_agreement_versions a where a.id=agreement
  union all select t.id,t.language from public.seller_agreement_translations t where t.tenant_id=p_tenant and t.agreement_id=agreement
 ) texts;
 return result||jsonb_build_object('languages',languages);
end $$;

-- Read-only, paged acceptance register for an exact store agreement version.
create or replace function public.agreement_sellers(p_tenant uuid,p_agreement uuid,p_query text,p_status text,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_query is null or length(p_query)>120 or p_status is null or p_status not in ('all','accepted','missing')
  or p_offset is null or p_offset<0 or p_offset>25000000 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.seller_agreement_versions where tenant_id=p_tenant and id=p_agreement) then raise exception 'AGREEMENT_NOT_FOUND'; end if;
 with matching as (
  select s.id,s.name,s.email,s.phone,e.id evidence_id,e.recorded_at,e.source,e.reference,e.translation_id
  from public.sellers s left join lateral (
   select ev.id,ev.recorded_at,ev.source,ev.reference,ev.translation_id from public.seller_agreement_evidence ev
   where ev.tenant_id=p_tenant and ev.seller_id=s.id and ev.agreement_id=p_agreement
   order by ev.recorded_at desc,ev.id desc limit 1
  ) e on true
  where s.tenant_id=p_tenant and (trim(p_query)='' or position(lower(trim(p_query)) in lower(s.name||' '||s.email||' '||s.phone))>0)
   and (p_status='all' or (p_status='accepted' and e.id is not null) or (p_status='missing' and e.id is null))
 ), page as (select * from matching order by lower(name),id limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from matching),'sellers',coalesce((
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,
   'acceptance',case when evidence_id is null then null else jsonb_build_object('id',evidence_id,'at',recorded_at,'source',source,'reference',reference,'translationId',translation_id,'language',coalesce((select language from public.seller_agreement_translations where id=translation_id),(select language from public.seller_agreement_versions where id=p_agreement))) end) order by lower(name),id) from page
 ),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.agreement_sellers(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.agreement_sellers(uuid,uuid,text,text,integer) to authenticated;


-- Extend the existing audited owner/admin export; no raw model attempts or image binaries.
create or replace function public.seller_data_export(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.sellers; result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 result:=jsonb_build_object(
  'exportedAt',now(),'exportedBy',uid,'tenantId',p_tenant,
  'seller',to_jsonb(s)-'tenant_id',
  'profileHistory',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.revision),'[]') from public.seller_profile_versions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'terms',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.version),'[]') from public.seller_terms_versions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'agreementEvidence',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.recorded_at),'[]') from public.seller_agreement_evidence x where x.tenant_id=p_tenant and x.seller_id=p_seller),

  'acceptedAgreementTranslations',(select coalesce(jsonb_agg(to_jsonb(t)-'tenant_id' order by t.created_at,t.id),'[]') from public.seller_agreement_translations t where t.tenant_id=p_tenant and exists(select 1 from public.seller_agreement_evidence e where e.tenant_id=p_tenant and e.seller_id=p_seller and e.translation_id=t.id)),
  'acceptedAgreements',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'version',a.version,'title',a.title,'body',a.body,'language',a.language) order by a.version),'[]') from public.seller_agreement_versions a where a.tenant_id=p_tenant and exists(select 1 from public.seller_agreement_evidence e where e.tenant_id=p_tenant and e.seller_id=p_seller and e.agreement_id=a.id)),
  'photoSubmissions',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'seller_id',x.seller_id,'previous_id',x.previous_id,'description',x.description,'photos',x.photos,'created_by',x.created_by,'created_at',x.created_at,'pricing_mode',x.pricing_mode,'seller_price',x.seller_price,'price_currency',x.price_currency,'assistance_output',x.assistance_output) order by x.created_at,x.id),'[]') from public.seller_submissions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'photoSubmissionReviews',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'submission_id',r.submission_id,'decision',r.decision,'note',r.note,'price_approved',r.price_approved,'created_by',r.created_by,'created_at',r.created_at) order by r.created_at,r.id),'[]') from public.seller_submission_reviews r join public.seller_submissions x on x.tenant_id=r.tenant_id and x.id=r.submission_id where r.tenant_id=p_tenant and x.seller_id=p_seller),
  'submissionReceptions',(select coalesce(jsonb_agg(to_jsonb(r)-'tenant_id' order by r.created_at,r.submission_id),'[]') from public.submission_receptions r join public.seller_submissions x on x.tenant_id=r.tenant_id and x.id=r.submission_id join public.reception_sessions rs on rs.tenant_id=r.tenant_id and rs.id=r.session_id where r.tenant_id=p_tenant and x.seller_id=p_seller and rs.seller_id=p_seller),
  'notificationPreferences',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.seller_notification_preferences x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'handovers',(select coalesce(jsonb_agg(to_jsonb(h)-'tenant_id' order by h.created_at,h.id),'[]') from public.seller_handovers h where h.tenant_id=p_tenant and h.seller_id=p_seller),
  'handoverEvents',(select coalesce(jsonb_agg(to_jsonb(e)-'tenant_id' order by e.occurred_at,e.id),'[]') from public.handover_events e join public.seller_handovers h on h.tenant_id=e.tenant_id and h.id=e.handover_id where e.tenant_id=p_tenant and h.seller_id=p_seller),
  'bags',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.bag_receipts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'inspectionDrafts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.inspection_draft_revisions x where x.tenant_id=p_tenant and x.bag_id in (select id from public.bag_receipts where tenant_id=p_tenant and seller_id=p_seller)),
  'receptions',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_sessions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'receptionSources',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.reception_source_revisions x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionReviews',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_reviews x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionResponses',(select coalesce(jsonb_agg(to_jsonb(r)-'tenant_id'-'access_id' order by r.created_at,r.id),'[]') from public.reception_responses r join public.reception_reviews rv on rv.tenant_id=r.tenant_id and rv.id=r.review_id join public.reception_sessions rs on rs.tenant_id=rv.tenant_id and rs.id=rv.session_id where r.tenant_id=p_tenant and rs.seller_id=p_seller),
  'garments',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.garment_receipts x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'items',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.accepted_at),'[]') from public.items x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'itemEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.item_events x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'itemPrices',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.item_prices x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'saleLines',(select coalesce(jsonb_agg((to_jsonb(l)-'tenant_id')||jsonb_build_object('sale',to_jsonb(sa)-'tenant_id') order by sa.occurred_at),'[]') from public.sale_lines l join public.sales sa on sa.tenant_id=l.tenant_id and sa.id=l.sale_id where l.tenant_id=p_tenant and l.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'returns',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.sale_returns x where x.tenant_id=p_tenant and x.item_id in (select id from public.items where tenant_id=p_tenant and seller_id=p_seller)),
  'ledger',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at,x.id),'[]') from public.seller_ledger_entries x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payouts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.requested_at),'[]') from public.payouts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'payoutEvents',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.occurred_at),'[]') from public.payout_events x where x.tenant_id=p_tenant and x.payout_id in (select id from public.payouts where tenant_id=p_tenant and seller_id=p_seller)),
  'statements',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.number),'[]') from public.settlement_statements x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'statementLines',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.statement_id,x.line_no),'[]') from public.settlement_statement_lines x where x.tenant_id=p_tenant and x.statement_id in (select id from public.settlement_statements where tenant_id=p_tenant and seller_id=p_seller)),
  'communications',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.queued_at),'[]') from public.seller_communications x where x.tenant_id=p_tenant and x.seller_id=p_seller)
 );
 perform komisio_private.record_access(p_tenant,'seller.exported',p_seller,jsonb_build_object('items',jsonb_array_length(result->'items'),'ledger',jsonb_array_length(result->'ledger')));
 return result;
end $$;

revoke all on function public.seller_data_export(uuid,uuid) from public,anon;
grant execute on function public.seller_data_export(uuid,uuid) to authenticated;

revoke all on function public.publish_agreement_translation(uuid,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.publish_agreement_translation(uuid,uuid,uuid,text,text,text) to authenticated;

revoke all on function public.record_agreement_evidence_text(uuid,uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.record_agreement_evidence_text(uuid,uuid,uuid,uuid,text,uuid) to authenticated;

revoke all on function public.accept_my_seller_agreement_text(uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.accept_my_seller_agreement_text(uuid,uuid,uuid,uuid,uuid) to authenticated;

revoke all on function public.save_seller_with_agreement_text(uuid,uuid,uuid,integer,jsonb,uuid,text,uuid) from public,anon;
grant execute on function public.save_seller_with_agreement_text(uuid,uuid,uuid,integer,jsonb,uuid,text,uuid) to authenticated;

revoke all on function public.my_seller_agreement_text(uuid,uuid,uuid,integer,uuid) from public,anon;
grant execute on function public.my_seller_agreement_text(uuid,uuid,uuid,integer,uuid) to authenticated;
