-- Derived identifiers must be RFC 4122 shaped. md5(text)::uuid yields any
-- version and variant nibble, which the application's UUID validation
-- rejects, so pages reading a settled payout or a received handover failed.
-- derived_id keeps the md5 bytes but sets the version nibble to 5 and the
-- variant to 8, matching the application's derivation. The four functions
-- that derive ids are re-declared to use it; their behaviour is otherwise
-- unchanged. No staging row used the raw shape before this migration.
create function komisio_private.derived_id(p_key text) returns uuid
language sql immutable set search_path='' as $$
 select overlay(overlay(md5(p_key) placing '5' from 13) placing '8' from 17)::uuid;
$$;
revoke all on function komisio_private.derived_id(text) from public,anon,authenticated;

create or replace function public.settle_payouts(p_tenant uuid,p_id uuid,p_sellers jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.payout_batches; note text:=trim(coalesce(p_reason,'')); r jsonb; seller uuid; payout uuid; total bigint;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or length(note) not between 1 and 500 or not komisio_private.valid_settlement_sellers(p_sellers) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.payout_batches where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.sellers is distinct from p_sellers or prior.reason is distinct from note or prior.created_by is distinct from uid then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 total:=komisio_private.check_settlement(p_tenant,p_sellers);
 for r in select * from jsonb_array_elements(p_sellers) loop
  seller:=(r->>'sellerId')::uuid;
  payout:=komisio_private.derived_id(p_id::text||':'||seller::text);
  perform komisio_private.request_payout_core(p_tenant,payout,seller,(r->>'amountOre')::bigint,'staff');
  perform komisio_private.transition_payout(p_tenant,komisio_private.derived_id(p_id::text||':'||seller::text||':approved'),payout,'approved',note,'');
 end loop;
 insert into public.payout_batches(id,tenant_id,sellers,reason,payout_count,total_ore,created_by) values(p_id,p_tenant,p_sellers,note,jsonb_array_length(p_sellers),total,uid);
 perform komisio_private.record_access(p_tenant,'payout.batch',p_id,jsonb_build_object('payouts',jsonb_array_length(p_sellers),'total_ore',total));
 return p_id;
end $$;

create or replace function public.receive_handover(p_tenant uuid,p_id uuid,p_handover uuid,p_source text,p_note text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.handover_events; h public.seller_handovers; bag uuid; agreement uuid; n text:=trim(coalesce(p_note,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_handover is null or p_source not in ('staff_receipt','locker') or length(n)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.handover_events where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.handover_id is distinct from p_handover or prior.kind is distinct from 'received' or prior.actor is distinct from uid or prior.note is distinct from n then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into h from public.seller_handovers where tenant_id=p_tenant and id=p_handover;
 if not found then raise exception 'HANDOVER_NOT_FOUND'; end if;
 if h.status<>'open' then raise exception 'HANDOVER_DECIDED'; end if;
 if p_source='locker' and not komisio_private.custody_source_allowed(p_tenant,'locker') then raise exception 'CUSTODY_SOURCE_NOT_ALLOWED'; end if;
 select id into agreement from public.seller_agreement_versions where tenant_id=p_tenant order by version desc limit 1;
 bag:=komisio_private.derived_id(h.id::text||':received');
 perform public.receive_bag_with_agreement(p_tenant,bag,h.seller_id,case when n='' then 'H-'||h.reference else n end,agreement);
 perform set_config('komisio.handover_transition','engine',true);
 update public.seller_handovers set status='received',received_bag_id=bag,received_at=now(),custody_source=p_source where id=h.id;
 perform set_config('komisio.handover_transition','',true);
 insert into public.handover_events(id,tenant_id,handover_id,kind,note,actor) values(p_id,p_tenant,h.id,'received',n,uid);
 perform komisio_private.record_access(p_tenant,'handover.received',h.id,jsonb_build_object('bag_id',bag,'custody_source',p_source));
 return p_id;
end $$;

create or replace function komisio_private.run_markdowns(p_tenant uuid,p_run uuid,p_mode text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.items; f jsonb; price bigint; applied jsonb:='[]'::jsonb; prior public.markdown_runs;
begin
 select * into prior from public.markdown_runs where id=p_run;
 if found then
  if prior.tenant_id is distinct from p_tenant then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('runId',prior.id,'appliedCount',prior.applied_count,'applied',prior.applied,'replayed',true);
 end if;
 for item in select * from public.items i where i.tenant_id=p_tenant order by i.accepted_at,i.id loop
  f:=komisio_private.item_lifecycle(p_tenant,item.id);
  if f->>'stage'='markdown_due' then
   price:=komisio_private.markdown_item(p_tenant,p_actor,komisio_private.derived_id(p_run::text||':'||item.id::text||':'||(f->>'dueStep')),item.id,(f->>'dueStep')::integer);
   if price is not null then applied:=applied||jsonb_build_object('itemId',item.id,'step',(f->>'dueStep')::integer,'percent',(f->>'duePercent')::numeric,'priceOre',price); end if;
  end if;
 end loop;
 insert into public.markdown_runs(id,tenant_id,mode,actor,applied_count,applied) values(p_run,p_tenant,p_mode,p_actor,jsonb_array_length(applied),applied);
 perform komisio_private.record_access(p_tenant,'markdown.run',p_run,jsonb_build_object('mode',p_mode,'applied',jsonb_array_length(applied)));
 return jsonb_build_object('runId',p_run,'appliedCount',jsonb_array_length(applied),'applied',applied,'replayed',false);
end $$;

create or replace function komisio_private.run_automatic_markdowns() returns jsonb
language plpgsql security definer set search_path='' as $$
declare t record; result jsonb; runs jsonb:='[]'::jsonb; today text:=to_char(now() at time zone 'Europe/Stockholm','YYYY-MM-DD');
begin
 for t in select v.tenant_id,v.created_by from public.store_policy_versions v
  where v.version=(select max(version) from public.store_policy_versions x where x.tenant_id=v.tenant_id) and (v.policy->>'automaticMarkdowns')::boolean loop
  perform 1 from public.tenants where id=t.tenant_id for update;
  result:=komisio_private.run_markdowns(t.tenant_id,komisio_private.derived_id('automatic-markdowns:'||t.tenant_id::text||':'||today),'automatic',t.created_by);
  runs:=runs||jsonb_build_object('tenantId',t.tenant_id,'appliedCount',result->'appliedCount','replayed',result->'replayed');
 end loop;
 return jsonb_build_object('day',today,'runs',runs);
end $$;
