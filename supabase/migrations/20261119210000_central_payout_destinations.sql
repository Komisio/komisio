-- The destination belongs to the individual request. The public payout and
-- events keep their existing manual execution, access and accounting contracts.
create table komisio_private.central_payout_destinations (
 payout_id uuid primary key,
 tenant_id uuid not null,
 seller_id uuid not null,
 method text not null,
 swish_phone text,
 bank_version uuid,
 created_at timestamptz not null default now(),
 foreign key(tenant_id,payout_id) references public.payouts(tenant_id,id) deferrable initially deferred,
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 foreign key(tenant_id,bank_version) references public.seller_bank_versions(tenant_id,id),
 check ((method='swish' and swish_phone is not null and swish_phone ~ '^\+467[023689][0-9]{7}$' and bank_version is null)
     or (method='bank' and swish_phone is null and bank_version is not null))
);
create index central_payout_latest_swish on komisio_private.central_payout_destinations(tenant_id,seller_id,created_at desc,payout_id) where method='swish';
create index central_payout_bank_version on komisio_private.central_payout_destinations(tenant_id,bank_version) where bank_version is not null;
alter table komisio_private.central_payout_destinations enable row level security;
revoke all on komisio_private.central_payout_destinations from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate on komisio_private.central_payout_destinations for each statement execute function komisio_private.guard_support_write();
create trigger immutable_destination before update or delete on komisio_private.central_payout_destinations
 for each row execute function komisio_private.preserve_correction();

-- New clients stage the exact destination inside the same transaction as the
-- request. Legacy and staff commands keep their bank route and pin its version.
create or replace function komisio_private.require_central_payout_bank() returns trigger
language plpgsql security definer set search_path='' as $$
declare version_id uuid;
begin
 if not exists(select 1 from public.platform_settings where only_row and central_app_tenant_id=new.tenant_id) then return new; end if;
 if exists(select 1 from komisio_private.central_payout_destinations where payout_id=new.id and tenant_id=new.tenant_id and seller_id=new.seller_id) then return new; end if;
 select id into version_id from public.seller_bank_versions where tenant_id=new.tenant_id and seller_id=new.seller_id order by seq desc limit 1;
 if version_id is null then raise exception 'PAYOUT_BANK_REQUIRED'; end if;
 insert into komisio_private.central_payout_destinations(payout_id,tenant_id,seller_id,method,bank_version)
 values(new.id,new.tenant_id,new.seller_id,'bank',version_id);
 return new;
end $$;

create function public.request_central_payout(p_tenant uuid,p_id uuid,p_seller uuid,p_amount_ore bigint,p_destination jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare method text:=p_destination->>'method'; phone text; bank uuid; existing komisio_private.central_payout_destinations;
begin
 perform komisio_private.require_seller(p_tenant,p_seller);
 perform 1 from public.tenants where id=p_tenant for update;
 if p_tenant is distinct from (public.public_central_app_recipient()->>'id')::uuid then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or jsonb_typeof(p_destination) is distinct from 'object' then raise exception 'INVALID_INPUT'; end if;
 if method='swish' and jsonb_typeof(p_destination->'phone')='string' and p_destination - 'method' - 'phone'='{}'::jsonb then
  phone:=p_destination->>'phone';
  if phone !~ '^\+467[023689][0-9]{7}$' then raise exception 'INVALID_INPUT'; end if;
 elsif method='bank' and jsonb_typeof(p_destination->'bankVersionId')='string' and p_destination - 'method' - 'bankVersionId'='{}'::jsonb then
  if (p_destination->>'bankVersionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_INPUT'; end if;
  bank:=(p_destination->>'bankVersionId')::uuid;
 else raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.payouts where id=p_id) then
  select * into existing from komisio_private.central_payout_destinations where payout_id=p_id;
  if not found or (existing.tenant_id,existing.seller_id,existing.method,existing.swish_phone,existing.bank_version)
     is distinct from (p_tenant,p_seller,method,phone,bank) then raise exception 'REQUEST_CONFLICT'; end if;
 else
  if method='bank' and bank is distinct from (select id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1)
    then raise exception 'BANK_DETAILS_CHANGED'; end if;
  insert into komisio_private.central_payout_destinations(payout_id,tenant_id,seller_id,method,swish_phone,bank_version)
   values(p_id,p_tenant,p_seller,method,phone,bank);
 end if;
 return public.request_my_payout(p_tenant,p_id,p_seller,p_amount_ore);
end $$;
revoke all on function public.request_central_payout(uuid,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.request_central_payout(uuid,uuid,uuid,bigint,jsonb) to authenticated;

-- Bank review and settlement use the same frozen version. Older/ordinary
-- payouts still resolve the seller's current version as before.
create function komisio_private.payout_bank_version(p_tenant uuid,p_payout uuid,p_seller uuid) returns uuid
language sql stable set search_path='' as $$
 select case when d.payout_id is not null then d.bank_version else
 (select id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1) end
 from (select 1) anchor left join komisio_private.central_payout_destinations d on d.tenant_id=p_tenant and d.payout_id=p_payout and d.seller_id=p_seller
$$;
revoke all on function komisio_private.payout_bank_version(uuid,uuid,uuid) from public,anon,authenticated;

do $$ declare d text; needle text; old text; begin
 d:=pg_get_functiondef('public.review_payout_bank_details(uuid,uuid,uuid,uuid)'::regprocedure);
 needle:='select id into current_id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=payout.seller_id order by seq desc limit 1;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BANK_REVIEW'; end if;
 execute replace(d,needle,'current_id:=komisio_private.payout_bank_version(p_tenant,p_payout,payout.seller_id);');
 d:=pg_get_functiondef('komisio_private.guard_payout_bank(uuid,uuid,text)'::regprocedure);
 needle:='select id into current_id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=seller order by seq desc limit 1;';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BANK_GUARD'; end if;
 execute replace(d,needle,'current_id:=komisio_private.payout_bank_version(p_tenant,p_payout,seller);');
 d:=pg_get_functiondef('public.payout_bank_details(uuid,uuid)'::regprocedure);
 needle:='current_details:=public.seller_bank_details(p_tenant,seller);';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BANK_DETAILS'; end if;
 execute replace(d,needle,$body$
 if exists(select 1 from komisio_private.central_payout_destinations where tenant_id=p_tenant and payout_id=p_payout and method='swish') then
  return (select jsonb_build_object('swishPhone',swish_phone,'current',null,'reviewed',null,'needsReview',false)
   from komisio_private.central_payout_destinations where tenant_id=p_tenant and payout_id=p_payout);
 end if;
 select jsonb_build_object('id',id,'details',details,'createdAt',created_at) into current_details from public.seller_bank_versions
 where tenant_id=p_tenant and id=komisio_private.payout_bank_version(p_tenant,p_payout,seller);
 $body$);
 d:=pg_get_functiondef('public.my_seller_payouts_page(uuid,uuid,integer)'::regprocedure);
 needle:='return jsonb_build_object(''tenantId'',p_tenant';
 if position(needle in d)=0 then raise exception 'UNEXPECTED_PAYOUT_PAGE'; end if;
 execute replace(d,needle,$body$return (case when p_tenant=(public.public_central_app_recipient()->>'id')::uuid then
 jsonb_build_object('centralPayout',jsonb_build_object('enabled',true,
 'bankVersionId',(select id from public.seller_bank_versions where tenant_id=p_tenant and seller_id=p_seller order by seq desc limit 1),
 'suggestedPhone',coalesce((select swish_phone from komisio_private.central_payout_destinations where tenant_id=p_tenant and seller_id=p_seller and method='swish' order by created_at desc,payout_id limit 1),
 (select profile#>>'{shippingContact,phone}' from public.sellers where tenant_id=p_tenant and id=p_seller and profile#>>'{shippingContact,phone}' ~ '^\+467[023689][0-9]{7}$'))))
 else '{}'::jsonb end) || jsonb_build_object('tenantId',p_tenant$body$);
 -- Treat a bank version referenced by a payout as retained financial evidence,
 -- just like an already-reviewed version, including the erasure preview counts.
 needle:='exists(select 1 from public.payout_bank_reviews r where r.tenant_id=b.tenant_id and r.bank_version=b.id)';
 old:='('||needle||' or exists(select 1 from komisio_private.central_payout_destinations x where x.tenant_id=b.tenant_id and x.bank_version=b.id))';
 d:=pg_get_functiondef('komisio_private.erase_unreferenced_bank_details()'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BANK_ERASURE'; end if;
 execute replace(d,needle,old);
 d:=pg_get_functiondef('public.seller_privacy_preview(uuid,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'UNEXPECTED_BANK_PREVIEW'; end if;
 execute replace(d,needle,old);
end $$;
notify pgrst,'reload schema';
