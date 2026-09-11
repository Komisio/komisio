create table public.seller_agreement_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 title text not null check(length(trim(title)) between 1 and 120),
 body text not null check(length(trim(body)) between 1 and 12000),
 language text not null check(language in ('sv','en')),
 required_before_receipt boolean not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id),
 unique(tenant_id,version)
);
create table public.seller_agreement_evidence (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 agreement_id uuid not null,
 seller_id uuid not null,
 reference text not null check(length(trim(reference)) between 1 and 500),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 foreign key(tenant_id,agreement_id) references public.seller_agreement_versions(tenant_id,id),
 foreign key(tenant_id,seller_id) references public.sellers(tenant_id,id),
 unique(tenant_id,agreement_id,seller_id,id)
);
create index seller_evidence_lookup on public.seller_agreement_evidence(tenant_id,seller_id,agreement_id,recorded_at desc);
alter table public.bag_receipts
 add column agreement_version_id uuid,
 add column agreement_evidence_id uuid,
 add foreign key(tenant_id,agreement_version_id) references public.seller_agreement_versions(tenant_id,id),
 add foreign key(tenant_id,agreement_version_id,seller_id,agreement_evidence_id)
  references public.seller_agreement_evidence(tenant_id,agreement_id,seller_id,id),
 add check(agreement_evidence_id is null or agreement_version_id is not null);
alter table public.seller_agreement_versions enable row level security;
alter table public.seller_agreement_evidence enable row level security;
create policy agreement_read on public.seller_agreement_versions for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
create policy evidence_read on public.seller_agreement_evidence for select to authenticated
 using(tenant_id in (select public.user_tenant_ids()));
revoke all on public.seller_agreement_versions,public.seller_agreement_evidence from public,anon,authenticated;
grant select on public.seller_agreement_versions,public.seller_agreement_evidence to authenticated;

create function komisio_private.preserve_agreement_record() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_AGREEMENT_RECORD' using errcode='55000'; end $$;
create trigger immutable_agreement before update or delete on public.seller_agreement_versions
 for each row execute function komisio_private.preserve_agreement_record();
create trigger immutable_evidence before update or delete on public.seller_agreement_evidence
 for each row execute function komisio_private.preserve_agreement_record();

create function public.publish_seller_agreement(p_tenant uuid,p_id uuid,p_expected_current uuid,p_title text,p_body text,p_language text,p_required boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.seller_agreement_versions;
 current_version public.seller_agreement_versions; t text:=trim(p_title); b text:=trim(p_body);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or t is null or length(t) not between 1 and 120 or b is null or length(b) not between 1 and 12000
 or p_language is null or p_language not in ('sv','en') or p_required is null then raise exception 'INVALID_INPUT'; end if;
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

create function public.record_agreement_evidence(p_tenant uuid,p_id uuid,p_seller uuid,p_agreement uuid,p_reference text)
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
  or previous.reference is distinct from r then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.sellers where tenant_id=p_tenant and id=p_seller) then raise exception 'SELLER_NOT_FOUND'; end if;
 select id into current_id from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_id is distinct from p_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 insert into public.seller_agreement_evidence(id,tenant_id,agreement_id,seller_id,reference,recorded_by)
 values(p_id,p_tenant,p_agreement,p_seller,r,uid);
 perform komisio_private.record_access(p_tenant,'agreement.evidence_recorded',p_id,jsonb_build_object('agreement_id',p_agreement));
 return p_id;
end $$;

create function public.receive_bag_with_agreement(p_tenant uuid,p_id uuid,p_seller uuid,p_note text,p_expected_agreement uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); previous public.bag_receipts;
 current_version public.seller_agreement_versions; evidence_id uuid; n text:=trim(p_note);
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_seller is null or n is null or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Replay is resolved before changed policy prerequisites; no previous receipt is rewritten.
 select * into previous from public.bag_receipts where id=p_id;
 if found then
  if previous.tenant_id is distinct from p_tenant or previous.created_by is distinct from uid
  or previous.seller_id is distinct from p_seller or previous.note is distinct from n
  or previous.agreement_version_id is distinct from p_expected_agreement then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if not exists(select 1 from public.sellers where id=p_seller and tenant_id=p_tenant) then raise exception 'SELLER_NOT_FOUND'; end if;
 select * into current_version from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_agreement then raise exception 'AGREEMENT_CHANGED'; end if;
 select id into evidence_id from public.seller_agreement_evidence
 where tenant_id=p_tenant and seller_id=p_seller and agreement_id=current_version.id order by recorded_at desc,id limit 1;
 if current_version.required_before_receipt and evidence_id is null then raise exception 'AGREEMENT_REQUIRED'; end if;
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by,agreement_version_id,agreement_evidence_id)
 values(p_id,p_tenant,p_seller,n,uid,current_version.id,evidence_id);
 perform komisio_private.record_access(p_tenant,'bag.received',p_id,jsonb_build_object('agreement_id',current_version.id,'evidence_id',evidence_id));
 return p_id;
end $$;

-- Preserve the existing signature for no-agreement clients and exact old retries.
-- Once an agreement is published, callers must explicitly supply its reviewed version.
create or replace function public.receive_bag(p_tenant uuid,p_id uuid,p_seller uuid,p_note text)
returns uuid language sql security invoker set search_path='' as $$
 select public.receive_bag_with_agreement(p_tenant,p_id,p_seller,p_note,null);
$$;
revoke all on function public.publish_seller_agreement(uuid,uuid,uuid,text,text,text,boolean),
 public.record_agreement_evidence(uuid,uuid,uuid,uuid,text),public.receive_bag_with_agreement(uuid,uuid,uuid,text,uuid)
 from public,anon;
grant execute on function public.publish_seller_agreement(uuid,uuid,uuid,text,text,text,boolean),
 public.record_agreement_evidence(uuid,uuid,uuid,uuid,text),public.receive_bag_with_agreement(uuid,uuid,uuid,text,uuid)
 to authenticated;
