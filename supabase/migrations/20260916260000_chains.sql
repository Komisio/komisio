-- Chains (owner decision 2026-09-15, step 1 of docs/CHAIN-GROUPING.md): an
-- optional label above stores, set by an owner of every store grouped, with
-- one cross-store read for owners or admins of every store in the chain.
-- Isolation is unchanged: every fact stays in its store, no write crosses
-- stores, and membership is still per store. Each store keeps its own plan.
create table public.chains (
 id uuid primary key,
 name text not null check(length(trim(name)) between 1 and 100),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.tenants add column chain_id uuid references public.chains(id);
create index tenants_chain on public.tenants(chain_id) where chain_id is not null;
alter table public.chains enable row level security;
create policy chains_read on public.chains for select to authenticated
 using(exists(select 1 from public.tenants t where t.chain_id=chains.id and t.id in (select public.user_tenant_ids())));
revoke all on public.chains from public,anon,authenticated;
grant select on public.chains to authenticated;

-- The chain label changes only through the functions below; an owner's direct
-- update of the tenant row (allowed for the name) cannot move a store.
create function komisio_private.chain_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.chain_id is distinct from old.chain_id and coalesce(current_setting('komisio.chain_transition',true),'')<>'engine' then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 return new;
end $$;
create trigger tenants_chain_guard before update on public.tenants for each row execute function komisio_private.chain_guard();

create function komisio_private.set_chain(p_tenant uuid,p_chain uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform set_config('komisio.chain_transition','engine',true);
 update public.tenants set chain_id=p_chain where id=p_tenant;
 perform set_config('komisio.chain_transition','',true);
 perform komisio_private.record_access(p_tenant,p_action,coalesce(p_chain,p_tenant),jsonb_build_object('chain_id',p_chain));
end $$;
revoke all on function komisio_private.set_chain(uuid,uuid,text) from public,anon,authenticated;

-- Create a chain from stores the caller owns, none of which is in a chain yet.
-- Replay-safe by id: the same creator gets the same chain back.
create function public.create_chain(p_id uuid,p_name text,p_tenants uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); existing public.chains; t uuid; n text:=trim(coalesce(p_name,''));
begin
 if p_id is null or length(n) not between 1 and 100 or p_tenants is null or cardinality(p_tenants)<1 or cardinality(p_tenants)>50
  or (select count(distinct x) from unnest(p_tenants) x)<>cardinality(p_tenants) then raise exception 'INVALID_INPUT'; end if;
 select * into existing from public.chains where id=p_id;
 if found then
  if existing.created_by<>uid then raise exception 'REQUEST_CONFLICT'; end if;
  return existing.id;
 end if;
 foreach t in array p_tenants loop
  perform 1 from public.tenants where id=t for update;
  if coalesce(public.tenant_role(t),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.tenants where id=t and chain_id is not null) then raise exception 'CHAIN_CONFLICT'; end if;
 end loop;
 insert into public.chains(id,name,created_by) values(p_id,n,uid);
 foreach t in array p_tenants loop
  perform komisio_private.set_chain(t,p_id,'chain.joined');
 end loop;
 return p_id;
end $$;

-- Add a store the caller owns to a chain where the caller already owns a store.
create function public.join_chain(p_chain uuid,p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform komisio_private.require_identity();
 if p_chain is null or p_tenant is null then raise exception 'INVALID_INPUT'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.chains where id=p_chain) then raise exception 'CHAIN_NOT_FOUND'; end if;
 if not exists(select 1 from public.tenants t where t.chain_id=p_chain and coalesce(public.tenant_role(t.id),'')='owner') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if exists(select 1 from public.tenants where id=p_tenant and chain_id is not null) then raise exception 'CHAIN_CONFLICT'; end if;
 perform komisio_private.set_chain(p_tenant,p_chain,'chain.joined');
end $$;

-- Take a store the caller owns out of its chain; an emptied chain is removed.
create function public.leave_chain(p_tenant uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 perform komisio_private.require_identity();
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select chain_id into c from public.tenants where id=p_tenant;
 if c is null then raise exception 'CHAIN_NOT_FOUND'; end if;
 perform komisio_private.set_chain(p_tenant,null,'chain.left');
 delete from public.chains where id=c and not exists(select 1 from public.tenants where chain_id=c);
end $$;

-- The chain of one store as its members see it: null without a chain, otherwise
-- the chain and every store in it with the caller's role there (null when the
-- caller is not a member of that store). Names only; nothing financial.
create function public.chain_overview(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.chains; stores jsonb;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select ch.* into c from public.chains ch join public.tenants t on t.chain_id=ch.id where t.id=p_tenant;
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'role',public.tenant_role(t.id)) order by t.name,t.id),'[]'::jsonb) into stores
 from public.tenants t where t.chain_id=c.id;
 return jsonb_build_object('id',c.id,'name',c.name,'createdAt',c.created_at,'stores',stores);
end $$;

-- Per-store economy summaries side by side and their total, for a caller who is
-- owner or admin in every store of the chain. Reuses economy_summary, so the
-- sums are the day close's sums. Money is summed only when every store has the
-- same currency; otherwise the total carries no amounts and says so.
create function public.chain_economy_summary(p_chain uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t record; s jsonb; stores jsonb:='[]'::jsonb; n integer:=0; currencies text[]:='{}';
 keys text[]:=array['salesCount','linesCount','grossOre','vatOre','netOre','commissionOre','commissionVatOre','sellerCreditOre','returnsCount','refundsOre','creditReversedOre','payoutsPaidCount','payoutsPaidOre'];
 total jsonb:='{}'::jsonb; k text; owed bigint:=0; open_count integer:=0; open_amount bigint:=0; mixed boolean;
begin
 perform komisio_private.require_identity();
 if not exists(select 1 from public.chains where id=p_chain) then raise exception 'CHAIN_NOT_FOUND'; end if;
 for t in select id,name from public.tenants where chain_id=p_chain order by name,id loop
  if coalesce(public.tenant_role(t.id),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 end loop;
 foreach k in array keys loop total:=total||jsonb_build_object(k,0); end loop;
 for t in select id,name,slug from public.tenants where chain_id=p_chain order by name,id loop
  s:=public.economy_summary(t.id,p_from,p_to);
  n:=n+1;
  currencies:=array_append(currencies,s->>'currency');
  stores:=stores||jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'currency',s->>'currency','totals',s->'totals','liability',s->'liability','openPayouts',s->'openPayouts');
  foreach k in array keys loop
   total:=total||jsonb_build_object(k,(total->>k)::bigint+coalesce((s->'totals'->>k)::bigint,0));
  end loop;
  owed:=owed+coalesce((s->'liability'->>'owedOre')::bigint,0);
  open_count:=open_count+coalesce((s->'openPayouts'->>'count')::integer,0);
  open_amount:=open_amount+coalesce((s->'openPayouts'->>'amountOre')::bigint,0);
 end loop;
 mixed:=(select count(distinct x) from unnest(currencies) x)>1;
 return jsonb_build_object('chainId',p_chain,'from',p_from,'to',p_to,'timeZone','Europe/Stockholm','storeCount',n,
  'currency',case when mixed or n=0 then null else currencies[1] end,'mixedCurrencies',mixed,
  'stores',stores,
  'total',case when mixed then null else total||jsonb_build_object('owedOre',owed,'openPayoutsCount',open_count,'openPayoutsOre',open_amount) end);
end $$;
revoke all on function public.create_chain(uuid,text,uuid[]),public.join_chain(uuid,uuid),public.leave_chain(uuid),public.chain_overview(uuid),public.chain_economy_summary(uuid,date,date) from public,anon;
grant execute on function public.create_chain(uuid,text,uuid[]),public.join_chain(uuid,uuid),public.leave_chain(uuid),public.chain_overview(uuid),public.chain_economy_summary(uuid,date,date) to authenticated;
