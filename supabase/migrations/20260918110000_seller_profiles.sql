-- Owner-approved seller profile editing. All writes are serialized with membership.
create function komisio_private.valid_seller_profile(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false; end if;
 if not(p ?& array['name','email','phone','addressLine1','addressLine2','postalCode','city','country','language','notes']) or (p-array['name','email','phone','addressLine1','addressLine2','postalCode','city','country','language','notes'])<>'{}' then return false; end if;
 for k in select jsonb_object_keys(p) loop
  if jsonb_typeof(p->k)<>'string' then return false; end if;
 end loop;
 return length(trim(p->>'name')) between 1 and 120
 and length(p->>'email')<=254 and length(p->>'phone')<=40
 and (trim(p->>'email')<>'' or trim(p->>'phone')<>'')
 and (p->>'email'='' or p->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 and length(p->>'addressLine1')<=160 and length(p->>'addressLine2')<=160
 and length(p->>'postalCode')<=24 and length(p->>'city')<=120 and length(p->>'country')<=80
 and p->>'language' in ('','sv','en','no','dk','fi','de','es','it') and length(p->>'notes')<=1000;
end $$;
revoke all on function komisio_private.valid_seller_profile(jsonb) from public,anon,authenticated;
alter table public.sellers add column profile jsonb,
 add column profile_revision integer not null default 0 check(profile_revision>=0),
 add constraint sellers_profile_valid check(profile is null or komisio_private.valid_seller_profile(profile));
create table public.seller_profile_versions (
 id uuid primary key, tenant_id uuid not null, seller_id uuid not null,
 revision integer not null check(revision>=0), profile jsonb not null check(komisio_private.valid_seller_profile(profile)),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id), unique(tenant_id,seller_id,revision)
);
alter table public.seller_profile_versions enable row level security;
revoke all on public.seller_profile_versions from public,anon,authenticated;
grant select on public.seller_profile_versions to authenticated;
create policy seller_profile_read on public.seller_profile_versions for select to authenticated using(tenant_id in (select public.user_tenant_ids()));
create trigger seller_profile_immutable before update or delete on public.seller_profile_versions for each row execute function komisio_private.preserve_payout_event();

create function public.save_seller_profile(p_tenant uuid,p_id uuid,p_seller uuid,p_expected integer,p_profile jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); s public.sellers; prior public.seller_profile_versions; normalized jsonb; original jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or p_expected is null or p_expected<0 or not komisio_private.valid_seller_profile(p_profile) then raise exception 'INVALID_INPUT'; end if;
 select jsonb_object_agg(key,trim(value)) into normalized from jsonb_each_text(p_profile);
 normalized:=jsonb_set(normalized,'{email}',to_jsonb(lower(normalized->>'email')));
 if not komisio_private.valid_seller_profile(normalized) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_profile_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.seller_id is distinct from p_seller or prior.created_by is distinct from uid or prior.revision<>p_expected+1 or prior.profile is distinct from normalized then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into s from public.sellers where tenant_id=p_tenant and id=p_seller for update;
 if not found then raise exception 'SELLER_NOT_FOUND'; end if;
 if s.profile_revision<>p_expected then raise exception 'PROFILE_CHANGED'; end if;
 if s.profile_revision=0 then
  original:=jsonb_build_object('name',s.name,'email',s.email,'phone',s.phone,'addressLine1','','addressLine2','','postalCode','','city','','country','','language','','notes','');
  insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by,created_at)
  values(gen_random_uuid(),p_tenant,p_seller,0,original,s.created_by,s.created_at);
 end if;
 insert into public.seller_profile_versions(id,tenant_id,seller_id,revision,profile,created_by)
 values(p_id,p_tenant,p_seller,p_expected+1,normalized,uid);
 update public.sellers set name=normalized->>'name',email=normalized->>'email',phone=normalized->>'phone',profile=normalized,profile_revision=p_expected+1 where tenant_id=p_tenant and id=p_seller;
 perform komisio_private.record_access(p_tenant,'seller.profile_saved',p_seller,jsonb_build_object('revision',p_expected+1));
 return p_id;
end $$;
revoke all on function public.save_seller_profile(uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_seller_profile(uuid,uuid,uuid,integer,jsonb) to authenticated;

create or replace function public.register_seller(p_tenant uuid,p_id uuid,p_name text,p_email text,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.sellers; initial_profile jsonb;
 n text:=trim(p_name); e text:=lower(trim(p_email)); ph text:=trim(p_phone);
begin
 -- Serialize with membership changes so a removed actor cannot finish a new write.
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then
  raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or n is null or length(n) not between 1 and 120
 or e is null or ph is null or length(e)>254 or length(ph)>40 or (e='' and ph='')
 or (e<>'' and e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
  raise exception 'INVALID_INPUT'; end if;
 insert into public.sellers(id,tenant_id,name,email,phone,created_by)
 values(p_id,p_tenant,n,e,ph,uid) on conflict(id) do nothing;
 if found then
  perform komisio_private.record_access(p_tenant,'seller.registered',p_id,'{}'::jsonb);
 else
  select * into previous from public.sellers where id=p_id;
  select profile into initial_profile from public.seller_profile_versions where tenant_id=p_tenant and seller_id=p_id and revision=0;
  if found then previous.name:=initial_profile->>'name'; previous.email:=initial_profile->>'email'; previous.phone:=initial_profile->>'phone'; end if;
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.name is distinct from n or previous.email is distinct from e or previous.phone is distinct from ph then
   raise exception 'REQUEST_CONFLICT'; end if;
 end if;
 return p_id;
end $$;

alter table public.settlement_statements add column seller_contact jsonb;
create function komisio_private.statement_seller_contact() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  select jsonb_build_object('name',name,'email',email,'phone',phone) into new.seller_contact from public.sellers where tenant_id=new.tenant_id and id=new.seller_id;
 elsif new.seller_contact is distinct from old.seller_contact then raise exception 'IMMUTABLE_STATEMENT' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function komisio_private.statement_seller_contact() from public,anon,authenticated;
create trigger statement_contact_snapshot before insert or update on public.settlement_statements for each row execute function komisio_private.statement_seller_contact();

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
  'notificationPreferences',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.seq),'[]') from public.seller_notification_preferences x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'bags',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.received_at),'[]') from public.bag_receipts x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'inspectionDrafts',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.inspection_draft_revisions x where x.tenant_id=p_tenant and x.bag_id in (select id from public.bag_receipts where tenant_id=p_tenant and seller_id=p_seller)),
  'receptions',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_sessions x where x.tenant_id=p_tenant and x.seller_id=p_seller),
  'receptionSources',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.saved_at),'[]') from public.reception_source_revisions x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
  'receptionReviews',(select coalesce(jsonb_agg(to_jsonb(x)-'tenant_id' order by x.created_at),'[]') from public.reception_reviews x where x.tenant_id=p_tenant and x.session_id in (select id from public.reception_sessions where tenant_id=p_tenant and seller_id=p_seller)),
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
