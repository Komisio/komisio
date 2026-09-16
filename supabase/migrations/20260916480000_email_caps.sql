-- Open e-mail delivery with a host cap per store (2026-09-16, Opus).
-- Production accepts any store, so the deployment's allowlist becomes `*` in
-- the application and the pilot's operator gate disappears. The abuse boundary
-- moves here, where no caller can bypass it: a store may queue at most the
-- host's number of seller messages and invitations per rolling day. The caps
-- are platform settings, not store policy, so a store cannot raise its own.
-- Exceeding a cap fails the queue call with a plain code; it never rolls back a
-- sale, a payout or a statement, because messages are queued outside those
-- transactions.
alter table public.platform_settings
 add column email_daily_cap integer not null default 1000 check(email_daily_cap>=0),
 add column invite_daily_cap integer not null default 25 check(invite_daily_cap>=0);

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
 -- The host's daily cap for this store. Checked after the idempotent return
 -- above, so retrying a message that already exists is never refused.
 if (select count(*) from public.seller_communications c where c.tenant_id=p_tenant and c.queued_at>now()-interval '1 day')
  >=(select s.email_daily_cap from public.platform_settings s) then raise exception 'EMAIL_DAILY_CAP' using errcode='55000'; end if;
 insert into public.seller_communications(id,tenant_id,seller_id,kind,template_key,template_version,locale,recipient,subject,body,reference_kind,reference_id,queued_by)
 values(p_id,p_tenant,p_seller,p_kind,p_template_key,p_template_version,p_locale,lower(seller.email),trim(p_subject),trim(p_body),p_reference_kind,p_reference_id,uid);
 perform komisio_private.record_access(p_tenant,'communication.queued',p_id,jsonb_build_object('seller_id',p_seller,'kind',p_kind,'reference_kind',p_reference_kind));
 return p_id;
end $$;

create or replace function create_invitation(p_tenant uuid,p_email text,p_role text,p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=komisio_private.require_identity(); actor_role text; iid uuid; address text:=lower(trim(p_email));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 actor_role:=public.tenant_role(p_tenant);
 if coalesce(actor_role,'') not in ('owner','admin') or (actor_role='admin' and p_role='admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(address)>254
 or p_role is null or p_role not in ('admin','staff','readonly') or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
 if exists(select 1 from public.tenant_members m join auth.users u on u.id=m.user_id where m.tenant_id=p_tenant and lower(u.email)=address) then raise exception 'ALREADY_MEMBER'; end if;
 if (select count(*) from public.tenant_invitations v where v.tenant_id=p_tenant and v.created_at>now()-interval '1 day')
  >=(select s.invite_daily_cap from public.platform_settings s) then raise exception 'INVITE_DAILY_CAP' using errcode='55000'; end if;
 update public.tenant_invitations set status='revoked' where tenant_id=p_tenant and email=address and status='pending';
 insert into public.tenant_invitations(tenant_id,email,role,token_hash,created_by) values(p_tenant,address,p_role,p_token_hash,uid) returning id into iid;
 perform komisio_private.record_access(p_tenant,'invitation.created',iid,jsonb_build_object('role',p_role));
 return iid;
end $$;

create or replace function public.ai_platform_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.platform_settings:=komisio_private.ai_settings(); p text:=komisio_private.usage_period(clock_timestamp());
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('enabled',s.ai_credits_enabled,'monthlyCapOre',s.ai_monthly_cap_ore,'includedOre',s.ai_included_ore,'packOre',s.ai_pack_ore,
  'reserveOre',s.ai_reserve_ore,'reserveBatchOre',s.ai_reserve_batch_ore,'inputOrePerMillion',s.ai_input_ore_per_million,'outputOrePerMillion',s.ai_output_ore_per_million,
  'period',p,'capUsedOre',komisio_private.ai_cap_used(p),
  'emailDailyCap',s.email_daily_cap,'inviteDailyCap',s.invite_daily_cap,
  'showcase',coalesce((select jsonb_agg(jsonb_build_object('tenantId',x.tenant_id,'label',x.label) order by x.added_at) from public.store_showcase x),'[]'::jsonb));
end $$;

create or replace function public.set_ai_platform_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if not public.is_platform_host() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'INVALID_INPUT'; end if;
 update public.platform_settings set
  ai_credits_enabled=coalesce((p->>'enabled')::boolean,ai_credits_enabled),
  ai_monthly_cap_ore=coalesce((p->>'monthlyCapOre')::bigint,ai_monthly_cap_ore),
  ai_included_ore=coalesce((p->>'includedOre')::integer,ai_included_ore),
  ai_pack_ore=coalesce((p->>'packOre')::integer,ai_pack_ore),
  ai_reserve_ore=coalesce((p->>'reserveOre')::integer,ai_reserve_ore),
  ai_reserve_batch_ore=coalesce((p->>'reserveBatchOre')::integer,ai_reserve_batch_ore),
  ai_input_ore_per_million=coalesce((p->>'inputOrePerMillion')::numeric,ai_input_ore_per_million),
  ai_output_ore_per_million=coalesce((p->>'outputOrePerMillion')::numeric,ai_output_ore_per_million),
  email_daily_cap=coalesce((p->>'emailDailyCap')::integer,email_daily_cap),
  invite_daily_cap=coalesce((p->>'inviteDailyCap')::integer,invite_daily_cap),
  updated_at=now() where only_row=true;
 return public.ai_platform_settings();
end $$;
