create table public.seller_bank_versions (
 id uuid primary key, tenant_id uuid not null, seller_id uuid not null,
 previous_id uuid, details jsonb not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), seq bigint generated always as identity,
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),unique(tenant_id,id)
);
create index seller_bank_current on public.seller_bank_versions(tenant_id,seller_id,seq desc);
create table public.payout_bank_reviews (
 id uuid primary key, tenant_id uuid not null, payout_id uuid not null, bank_version uuid not null,
 reviewed_by uuid not null references auth.users(id), reviewed_at timestamptz not null default now(), seq bigint generated always as identity,
 foreign key(tenant_id,payout_id) references public.payouts(tenant_id,id),
 foreign key(tenant_id,bank_version) references public.seller_bank_versions(tenant_id,id)
);
alter table public.seller_bank_versions enable row level security;
alter table public.payout_bank_reviews enable row level security;
revoke all on public.seller_bank_versions,public.payout_bank_reviews from public,anon,authenticated;
grant select on public.seller_bank_versions,public.payout_bank_reviews to authenticated;
create policy read_managers on public.seller_bank_versions for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create policy read_managers on public.payout_bank_reviews for select to authenticated using(public.tenant_role(tenant_id) in ('owner','admin'));
create trigger immutable_bank_review before update or delete on public.payout_bank_reviews for each row execute function komisio_private.preserve_correction();

create function komisio_private.guard_bank_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and komisio_private.seller_erasure_authorized(old.tenant_id,old.seller_id)
  and not exists(select 1 from public.payout_bank_reviews where tenant_id=old.tenant_id and bank_version=old.id) then return old; end if;
 raise exception 'IMMUTABLE_BANK_DETAILS';
end $$;
revoke all on function komisio_private.guard_bank_version() from public,anon,authenticated;
create trigger immutable_bank_version before update or delete on public.seller_bank_versions for each row execute function komisio_private.guard_bank_version();
create trigger bank_open_seller before insert on public.seller_bank_versions for each row execute function komisio_private.require_open_seller_row();

create function komisio_private.valid_bank_details(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare iban text; digits text:=''; c text; i integer;
begin
 if d is null or jsonb_typeof(d)<>'object' or not d ?& array['holder','country','kind','account','routing']
  or (select count(*) from jsonb_object_keys(d))<>5 or exists(select 1 from jsonb_each(d) where jsonb_typeof(value)<>'string') then return false; end if;
 if length(trim(d->>'holder')) not between 1 and 160 or d->>'country' !~ '^[A-Z]{2}$'
  or d->>'kind' not in ('iban','local') or length(trim(d->>'account')) not between 1 and 100 or length(d->>'routing')>100 then return false; end if;
 if d->>'kind'='iban' then
  iban:=d->>'account';
  if iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' or left(iban,2)<>d->>'country' then return false; end if;
  iban:=substr(iban,5)||left(iban,4);
  for i in 1..length(iban) loop
   c:=substr(iban,i,1); digits:=digits||case when c~'^[A-Z]$' then (ascii(c)-55)::text else c end;
  end loop;
  if mod(digits::numeric,97)<>1 then return false; end if;
 end if;
 return true;
end $$;
revoke all on function komisio_private.valid_bank_details(jsonb) from public,anon,authenticated;
alter table public.seller_bank_versions add constraint bank_details_valid check(komisio_private.valid_bank_details(details));

create function public.save_seller_bank_details(p_tenant uuid,p_id uuid,p_seller uuid,p_expected uuid,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid; prior public.seller_bank_versions; current_id uuid;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 uid:=komisio_private.require_seller(p_tenant,p_seller);
 if p_id is null or not komisio_private.valid_bank_details(p_details) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.seller_bank_versions where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.seller_id<>p_seller or prior.created_by<>uid or prior.previous_id is distinct from p_expected or prior.details<>p_details then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select id into current_id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1;
 if current_id is distinct from p_expected then raise exception 'BANK_DETAILS_CHANGED'; end if;
 insert into public.seller_bank_versions(id,tenant_id,seller_id,previous_id,details,created_by) values(p_id,p_tenant,p_seller,p_expected,p_details,uid);
 perform komisio_private.record_access(p_tenant,'seller.bank_details_saved',p_seller,jsonb_build_object('version',p_id));
 return p_id;
end $$;

create function public.seller_bank_details(p_tenant uuid,p_seller uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then perform komisio_private.require_seller(p_tenant,p_seller); end if;
 return (select jsonb_build_object('id',id,'details',details,'createdAt',created_at) from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1);
end $$;

create function public.payout_bank_details(p_tenant uuid,p_payout uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare seller uuid; reviewed jsonb; current_details jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select seller_id into seller from public.payouts where tenant_id=p_tenant and id=p_payout;
 if not found then raise exception 'PAYOUT_NOT_FOUND'; end if;
 current_details:=public.seller_bank_details(p_tenant,seller);
 select jsonb_build_object('id',b.id,'details',b.details,'createdAt',b.created_at) into reviewed from public.payout_bank_reviews r join public.seller_bank_versions b on b.tenant_id=r.tenant_id and b.id=r.bank_version where r.tenant_id=p_tenant and r.payout_id=p_payout order by r.seq desc limit 1;
 return jsonb_build_object('current',current_details,'reviewed',reviewed,'needsReview',current_details is not null and current_details->>'id' is distinct from reviewed->>'id');
end $$;

create function public.review_payout_bank_details(p_tenant uuid,p_id uuid,p_payout uuid,p_version uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); payout public.payouts; prior public.payout_bank_reviews; current_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_version is null or p_payout is null then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.payout_bank_reviews where id=p_id;
 if found then
  if prior.tenant_id<>p_tenant or prior.payout_id<>p_payout or prior.bank_version<>p_version or prior.reviewed_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into payout from public.payouts where tenant_id=p_tenant and id=p_payout;
 if not found or payout.status not in ('requested','approved') then raise exception 'PAYOUT_NOT_APPROVED'; end if;
 select id into current_id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=payout.seller_id order by seq desc limit 1;
 if current_id is distinct from p_version then raise exception 'BANK_DETAILS_CHANGED'; end if;
 insert into public.payout_bank_reviews(id,tenant_id,payout_id,bank_version,reviewed_by) values(p_id,p_tenant,p_payout,p_version,uid);
 perform komisio_private.record_access(p_tenant,'payout.bank_reviewed',p_payout,jsonb_build_object('version',p_version));
 return p_id;
end $$;
revoke all on function public.save_seller_bank_details(uuid,uuid,uuid,uuid,jsonb),public.seller_bank_details(uuid,uuid),public.payout_bank_details(uuid,uuid),public.review_payout_bank_details(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.save_seller_bank_details(uuid,uuid,uuid,uuid,jsonb),public.seller_bank_details(uuid,uuid),public.payout_bank_details(uuid,uuid),public.review_payout_bank_details(uuid,uuid,uuid,uuid) to authenticated;

-- Apply the same guard to single, batch and pending-operation transitions.
do $$ declare source text; begin
 source:=pg_get_functiondef('komisio_private.transition_payout(uuid,uuid,uuid,text,text,text)'::regprocedure);
 if position('perform set_config(''komisio.payout_transition'',''engine'',true);' in source)=0 then raise exception 'PAYOUT_TRANSITION_SHAPE_CHANGED'; end if;
 source:=replace(source,'perform set_config(''komisio.payout_transition'',''engine'',true);',
 'if p_kind in (''approved'',''paid'') then perform komisio_private.guard_payout_bank(p_tenant,p_payout,p_kind); end if;
 perform set_config(''komisio.payout_transition'',''engine'',true);');
 execute source;
end $$;

create function komisio_private.guard_payout_bank(p_tenant uuid,p_payout uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare seller uuid; current_id uuid; reviewed_id uuid;
begin
 select seller_id into seller from public.payouts where tenant_id=p_tenant and id=p_payout;
 select id into current_id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=seller order by seq desc limit 1;
 if current_id is null then return; end if;
 select bank_version into reviewed_id from public.payout_bank_reviews where tenant_id=p_tenant and payout_id=p_payout order by seq desc limit 1;
 if reviewed_id is distinct from current_id then raise exception 'PAYOUT_BANK_REVIEW_REQUIRED'; end if;
end $$;
revoke all on function komisio_private.guard_payout_bank(uuid,uuid,text) from public,anon,authenticated;

create function komisio_private.erase_unreferenced_bank_details() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.privacy_closed_at is not null and old.privacy_closed_at is null then
  delete from public.seller_bank_versions b where b.tenant_id=new.tenant_id and b.seller_id=new.id
   and not exists(select 1 from public.payout_bank_reviews r where r.tenant_id=b.tenant_id and r.bank_version=b.id);
 end if;
 return new;
end $$;
revoke all on function komisio_private.erase_unreferenced_bank_details() from public,anon,authenticated;
create trigger erase_unused_bank_details after update of privacy_closed_at on public.sellers for each row execute function komisio_private.erase_unreferenced_bank_details();

create function public.payout_bank_details_batch(p_tenant uuid,p_payouts uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_payouts is null or cardinality(p_payouts)>50 or array_position(p_payouts,null) is not null then raise exception 'INVALID_INPUT'; end if;
 return coalesce((select jsonb_object_agg(id::text,public.payout_bank_details(p_tenant,id)) from unnest(p_payouts) id),'{}');
end $$;
revoke all on function public.payout_bank_details_batch(uuid,uuid[]) from public,anon;
grant execute on function public.payout_bank_details_batch(uuid,uuid[]) to authenticated;

-- Retention previews include bank evidence without exposing account values.
do $$ declare source text; begin
 source:=pg_get_functiondef('public.seller_privacy_preview(uuid,uuid)'::regprocedure);
 if position('''profiles'',(select count(*)' in source)=0 then raise exception 'PRIVACY_PREVIEW_SHAPE_CHANGED'; end if;
 source:=replace(source,'''profiles'',(select count(*)',
 '''bankRemovable'',(select count(*) from public.seller_bank_versions b where b.tenant_id=p_tenant and b.seller_id=p_seller and not exists(select 1 from public.payout_bank_reviews r where r.tenant_id=b.tenant_id and r.bank_version=b.id)),
 ''bankRetained'',(select count(*) from public.seller_bank_versions b where b.tenant_id=p_tenant and b.seller_id=p_seller and exists(select 1 from public.payout_bank_reviews r where r.tenant_id=b.tenant_id and r.bank_version=b.id)),
 ''profiles'',(select count(*)');
 source:=replace(source,'''blockers'',blockers,''counts'',counts,''balance'',balance',
 '''blockers'',blockers,''counts'',counts,''balance'',balance,''bankVersion'',(select id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1)');
 execute source;
end $$;
