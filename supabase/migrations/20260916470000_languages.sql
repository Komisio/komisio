-- Eight languages (owner request 2026-09-16): the product speaks the same
-- languages as komisio.com. Every place that restricted a locale or a
-- language to Swedish and English now accepts sv, en, no, dk, fi, de, es, it.
-- Fixed e-mail templates still exist in Swedish and English; the application
-- sends English to the other locales.
alter table public.user_profiles drop constraint user_profiles_locale_check;
alter table public.user_profiles add constraint user_profiles_locale_check check(locale in ('sv','en','no','dk','fi','de','es','it'));
alter table public.seller_communications drop constraint seller_communications_locale_check;
alter table public.seller_communications add constraint seller_communications_locale_check check(locale in ('sv','en','no','dk','fi','de','es','it'));
alter table public.seller_agreement_versions drop constraint seller_agreement_versions_language_check;
alter table public.seller_agreement_versions add constraint seller_agreement_versions_language_check check(language in ('sv','en','no','dk','fi','de','es','it'));

create or replace function save_profile(p_name text,p_locale text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity();
begin
 if p_name is null or length(trim(p_name))>100 or p_locale is null or p_locale not in ('sv','en','no','dk','fi','de','es','it') then raise exception 'INVALID_INPUT'; end if;
 insert into public.user_profiles(user_id,display_name,locale) values(uid,trim(p_name),p_locale)
 on conflict(user_id) do update set display_name=excluded.display_name,locale=excluded.locale;
end $$;

create or replace function public.queue_seller_communication(p_tenant uuid,p_id uuid,p_seller uuid,p_kind text,p_template_key text,p_template_version text,p_locale text,p_subject text,p_body text,p_reference_kind text,p_reference_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.seller_communications; seller public.sellers; ok boolean;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_kind is null or p_kind not in ('item_accepted','item_sold','payout_approved','payout_paid','statement_issued','message')
  or p_locale not in ('sv','en','no','dk','fi','de','es','it') or p_subject is null or length(trim(p_subject)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 8000
  or p_template_key is null or length(p_template_key) not between 1 and 100 or p_template_version is null or length(p_template_version) not between 1 and 40
  or p_reference_kind not in ('item','sale_line','payout','statement','none') or ((p_reference_kind='none')<>(p_reference_id is null)) then raise exception 'INVALID_INPUT'; end if;
 select * into seller from public.sellers where tenant_id=p_tenant and id=p_seller;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 if seller.email='' then raise exception 'SELLER_EMAIL_MISSING'; end if;
 select * into prior from public.seller_communications where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.kind is distinct from p_kind or prior.subject is distinct from trim(p_subject)
   or prior.body is distinct from trim(p_body) or prior.reference_id is distinct from p_reference_id or prior.queued_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 -- The referenced fact must exist for this tenant and belong to this seller where the fact knows its seller.
 ok:=case p_reference_kind
  when 'none' then true
  when 'item' then exists(select 1 from public.items i where i.tenant_id=p_tenant and i.id=p_reference_id and i.seller_id=p_seller)
  when 'sale_line' then exists(select 1 from public.sale_lines l join public.items i on i.tenant_id=l.tenant_id and i.id=l.item_id where l.tenant_id=p_tenant and l.id=p_reference_id and i.seller_id=p_seller)
  when 'payout' then exists(select 1 from public.payouts p where p.tenant_id=p_tenant and p.id=p_reference_id and p.seller_id=p_seller)
  when 'statement' then exists(select 1 from public.settlement_statements s where s.tenant_id=p_tenant and s.id=p_reference_id and s.seller_id=p_seller)
  end;
 if not ok then raise exception 'REFERENCE_NOT_FOUND'; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by)
 values(p_id,p_tenant,p_seller,p_kind,p_template_key,p_template_version,p_locale,lower(seller.email),trim(p_subject),trim(p_body),p_reference_kind,p_reference_id,uid);
 perform komisio_private.record_access(p_tenant,'communication.queued',p_id,jsonb_build_object('seller_id',p_seller,'kind',p_kind,'reference_kind',p_reference_kind));
 return p_id;
end $$;

create or replace function komisio_private.op_validate_send_message(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['sellerId','locale','freeText']) or (value-array['sellerId','locale','freeText'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(value->'sellerId')<>'string' or (value->>'sellerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 if jsonb_typeof(value->'locale')<>'string' or value->>'locale' not in ('sv','en','no','dk','fi','de','es','it') then return false; end if;
 if jsonb_typeof(value->'freeText')<>'string' or length(trim(value->>'freeText')) not between 1 and 1000 then return false; end if;
 return true;
end $$;

create or replace function public.publish_seller_agreement(p_tenant uuid,p_id uuid,p_expected_current uuid,p_title text,p_body text,p_language text,p_required boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.seller_agreement_versions;
 current_version public.seller_agreement_versions; t text:=trim(p_title); b text:=trim(p_body);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or t is null or length(t) not between 1 and 120 or b is null or length(b) not between 1 and 12000
 or p_language is null or p_language not in ('sv','en','no','dk','fi','de','es','it') or p_required is null then raise exception 'INVALID_INPUT'; end if;
 select * into previous from public.seller_agreement_versions where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.title is distinct from t or previous.body is distinct from b or previous.language is distinct from p_language
  or previous.required_before_receipt is distinct from p_required then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'AGREEMENT_CHANGED'; end if;
 insert into public.seller_agreement_versions(id,tenant_id,version,title,body,language,required_before_receipt,created_by)
 values(p_id,p_tenant,coalesce(current_version.version,0)+1,t,b,p_language,p_required,uid);
 perform komisio_private.record_access(p_tenant,'agreement.published',p_id,jsonb_build_object('version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;

create or replace function komisio_private.valid_store_profile(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare h jsonb; n integer:=0; a jsonb; c jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['address','contact','openingHours','accepts','concept','language']) or (value-array['address','contact','openingHours','accepts','concept','language'])<>'{}'::jsonb then return false; end if;
 a:=value->'address';
 if jsonb_typeof(a)<>'object' or not(a ?& array['street','postalCode','city']) or (a-array['street','postalCode','city','country'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(a->'street')<>'string' or length(a->>'street')>120 or jsonb_typeof(a->'postalCode')<>'string' or length(a->>'postalCode')>20 or jsonb_typeof(a->'city')<>'string' or length(a->>'city')>120 then return false; end if;
 if a ? 'country' and (jsonb_typeof(a->'country') is distinct from 'string' or a->>'country' not in ('SE','NO','DK','FI','DE','ES','IT','GB','IE','FR','NL','BE','AT','PT','GR','EE','LV','LT','LU','CY','MT','SK','SI','HR','PL','CZ','HU','RO','BG','IS','LI','CH')) then return false; end if;
 c:=value->'contact';
 if jsonb_typeof(c)<>'object' or not(c ?& array['email','phone','website']) or (c-array['email','phone','website'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(c->'email')<>'string' or length(c->>'email')>254 or (c->>'email'<>'' and c->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then return false; end if;
 if jsonb_typeof(c->'phone')<>'string' or length(c->>'phone')>40 then return false; end if;
 if jsonb_typeof(c->'website')<>'string' or length(c->>'website')>200 or (c->>'website'<>'' and c->>'website' !~ '^https://[^\s]+$') then return false; end if;
 if jsonb_typeof(value->'openingHours')<>'array' or jsonb_array_length(value->'openingHours')>7 then return false; end if;
 for h in select * from jsonb_array_elements(value->'openingHours') loop
  n:=n+1;
  if jsonb_typeof(h)<>'object' or not(h ?& array['day','opens','closes']) or (h-array['day','opens','closes'])<>'{}'::jsonb then return false; end if;
  if h->>'day' not in ('mon','tue','wed','thu','fri','sat','sun') then return false; end if;
  if jsonb_typeof(h->'opens')<>'string' or (h->>'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(h->'closes')<>'string' or (h->>'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (h->>'opens')>=(h->>'closes') then return false; end if;
 end loop;
 if (select count(distinct e->>'day') from jsonb_array_elements(value->'openingHours') e)<>n then return false; end if;
 if jsonb_typeof(value->'accepts')<>'string' or length(value->>'accepts')>2000 or jsonb_typeof(value->'concept')<>'string' or length(value->>'concept')>2000 then return false; end if;
 if value->>'language' not in ('sv','en','no','dk','fi','de','es','it') then return false; end if;
 return true;
end $$;
