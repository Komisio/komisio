-- One rolling window for the stock count and its paginated item-list destination.
create function komisio_private.stock_period_nearing_end(p_stage text,p_end timestamptz)
returns boolean language sql stable set search_path='' as $$
 select p_stage not in ('sold','ended') and p_end>now() and p_end<=now()+interval '7 days'
$$;
revoke all on function komisio_private.stock_period_nearing_end(text,timestamptz) from public,anon,authenticated;

-- Additive read filter: retain the existing validation, paging and access checks.
do $migration$
declare source text:=pg_get_functiondef('public.items_search_page(uuid,jsonb,text,text,integer,integer)'::regprocedure); changed text;
begin
 changed:=replace(source, $old$'acceptedTo','endsBefore','photo'$old$, $new$'acceptedTo','endsBefore','periodWindow','photo'$new$);
 if changed=source then raise exception 'Missing item filter whitelist'; end if;
 source:=changed;
 changed:=replace(source, $old$if f->>'syncProvider' not in$old$, $new$if f->>'periodWindow' not in ('next7days') or f->>'syncProvider' not in$new$);
 if changed=source then raise exception 'Missing item filter validation'; end if;
 source:=changed;
 changed:=replace(source,
  $old$and (not f ? 'endsBefore' or period_end<(((f->>'endsBefore')::date+1)::timestamp at time zone 'Europe/Stockholm'))$old$,
  $new$and (not f ? 'endsBefore' or period_end<(((f->>'endsBefore')::date+1)::timestamp at time zone 'Europe/Stockholm'))
   and (not f ? 'periodWindow' or komisio_private.stock_period_nearing_end(stage,period_end))$new$);
 if changed=source then raise exception 'Missing item period predicate'; end if;
 execute changed;
end
$migration$;

create function public.stock_lifecycle_report(p_tenant uuid,p_ownership text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_ownership is not null and p_ownership not in ('consignment','store') then raise exception 'INVALID_INPUT'; end if;
 with facts as materialized (
  select i.ownership,l.value->>'stage' as stage,(l.value->>'periodEnd')::timestamptz as period_end,
   (l.value->>'currentPriceOre')::bigint as price
  from public.items i
  cross join lateral (select komisio_private.item_lifecycle(p_tenant,i.id) as value) l
  where i.tenant_id=p_tenant and (p_ownership is null or i.ownership=p_ownership)
   and not (l.value->>'sold')::boolean and not (l.value->>'ended')::boolean
 )
 select jsonb_build_object(
  'currency',komisio_private.store_currency(p_tenant),
  'asOf',now(),
  'stages',jsonb_build_object(
   'active',count(*) filter(where stage in ('on_sale','markdown_due','period_ending')),
   'on_sale',count(*) filter(where stage='on_sale'),
   'markdown_due',count(*) filter(where stage='markdown_due'),
   'period_ending',count(*) filter(where stage='period_ending'),
   'period_ended',count(*) filter(where stage='period_ended')),
  'nearingPeriodEnd',count(*) filter(where komisio_private.stock_period_nearing_end(stage,period_end)),
  'ownership',jsonb_build_object(
   'consignment',jsonb_build_object('inStock',count(*) filter(where ownership='consignment'),'stockValueOre',coalesce(sum(price) filter(where ownership='consignment'),0)),
   'store',jsonb_build_object('inStock',count(*) filter(where ownership='store'),'stockValueOre',coalesce(sum(price) filter(where ownership='store'),0)))
 ) into result from facts;
 return result;
end $$;
revoke all on function public.stock_lifecycle_report(uuid,text) from public,anon;
grant execute on function public.stock_lifecycle_report(uuid,text) to authenticated;
