-- Reuse the existing closure gate for every new financial fact.
do $$ declare t text; begin
 foreach t in array array['consignment_receipt_periods','seller_consignment_periods','consignment_fees','consignment_fee_events'] loop
  execute format('create trigger plan_gate before insert on public.%I for each row execute function komisio_private.plan_gate()',t);
 end loop;
end $$;
create or replace function komisio_private.run_automatic_consignment_fees() returns integer
language plpgsql security definer set search_path='' as $$
declare p record; n integer:=0;
begin
 for p in select s.* from public.seller_consignment_periods s
  join public.tenant_members m on m.tenant_id=s.tenant_id and m.user_id=s.authorized_by and m.role in ('owner','admin')
  where not (komisio_private.billing_enabled() and exists(select 1 from public.tenant_plans t where t.tenant_id=s.tenant_id and t.state in ('read_only','closed')))
   and exists(select 1 from public.consignment_fees f where f.period_id=s.id)
   and (select max(f.ends_at) from public.consignment_fees f where f.period_id=s.id)<=now()
  order by s.tenant_id,s.started_at,s.id loop
  -- Closure and membership changes serialize with this worker. Recheck after locking.
  perform 1 from public.tenants where id=p.tenant_id for update;
  if exists(select 1 from public.tenant_members where tenant_id=p.tenant_id and user_id=p.authorized_by and role in ('owner','admin'))
   and not (komisio_private.billing_enabled() and exists(select 1 from public.tenant_plans where tenant_id=p.tenant_id and state in ('read_only','closed'))) then
   n:=n+komisio_private.accrue_consignment_fees(p.id,now(),p.authorized_by);
  end if;
 end loop;
 return n;
end $$;
