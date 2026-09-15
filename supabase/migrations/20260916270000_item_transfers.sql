-- Item transfer between stores in a chain (owner decisions 2026-09-15, step 2
-- of docs/CHAIN-GROUPING.md). A transfer is not an update: the source store
-- ends the item's sale period with action 'transfer', and the target store
-- receives a bag for the same seller with one inspection draft carrying the
-- item's description, ready to be accepted under the target's own policy and
-- terms. The seller's balance stays in the source store. Only an owner or
-- admin of both stores may transfer; both stores must be in the same chain.
-- Store-owned items are not transferred by this slice (purchases stay where
-- the receipt is). No new table: the source event carries the target ids, so
-- a replay by id returns the same result.
create function public.transfer_item(p_from uuid,p_item uuid,p_to uuid,p_id uuid,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); note text:=trim(coalesce(p_note,'')); item public.items; src public.sellers; dst uuid;
 chain_from uuid; chain_to uuid; from_name text; facts jsonb; prior public.item_events; bag uuid; draft uuid; title text; category text;
 detail jsonb; first uuid; second uuid;
begin
 if p_from is null or p_to is null or p_item is null or p_id is null or p_from=p_to or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 -- Lock both stores in a fixed order so two opposite transfers cannot deadlock.
 if p_from<p_to then first:=p_from; second:=p_to; else first:=p_to; second:=p_from; end if;
 perform 1 from public.tenants where id=first for update;
 perform 1 from public.tenants where id=second for update;
 if coalesce(public.tenant_role(p_from),'') not in ('owner','admin') or coalesce(public.tenant_role(p_to),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select chain_id,name into chain_from,from_name from public.tenants where id=p_from;
 select chain_id into chain_to from public.tenants where id=p_to;
 if chain_from is null or chain_to is distinct from chain_from then raise exception 'NOT_SAME_CHAIN'; end if;
 select * into prior from public.item_events where id=p_id;
 if found then
  if prior.tenant_id<>p_from or prior.item_id<>p_item or prior.kind<>'period_ended' or prior.actor<>uid or prior.detail->>'action' is distinct from 'transfer' then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('transferred',true,'replayed',true,'toTenant',prior.detail->>'toTenant','sellerId',prior.detail->>'sellerId','bagId',prior.detail->>'bagId','draftId',prior.detail->>'draftId');
 end if;
 select * into item from public.items where tenant_id=p_from and id=p_item;
 if not found then raise exception 'ITEM_NOT_FOUND'; end if;
 if item.ownership<>'consignment' or item.seller_id is null then raise exception 'TRANSFER_UNSUPPORTED'; end if;
 facts:=komisio_private.item_lifecycle(p_from,p_item);
 if (facts->>'sold')::boolean then raise exception 'ITEM_NOT_ON_SALE'; end if;
 if (facts->>'ended')::boolean then raise exception 'ITEM_ENDED'; end if;
 select * into src from public.sellers where tenant_id=p_from and id=item.seller_id;
 -- The same person in the target store: matched by e-mail, else by phone; otherwise copied.
 if src.email<>'' then select id into dst from public.sellers where tenant_id=p_to and lower(email)=lower(src.email) order by created_at limit 1; end if;
 if dst is null and src.phone<>'' then select id into dst from public.sellers where tenant_id=p_to and phone=src.phone order by created_at limit 1; end if;
 if dst is null then
  dst:=gen_random_uuid();
  insert into public.sellers(id,tenant_id,name,email,phone,created_by) values(dst,p_to,src.name,src.email,src.phone,uid);
  perform komisio_private.record_access(p_to,'seller.registered',dst,jsonb_build_object('via','transfer','from_tenant',p_from));
 end if;
 title:=coalesce(komisio_private.item_title(p_from,p_item)->>'title','Transferred item');
 category:=coalesce(komisio_private.item_title(p_from,p_item)->>'category','');
 bag:=gen_random_uuid(); draft:=gen_random_uuid();
 insert into public.bag_receipts(id,tenant_id,seller_id,note,created_by)
 values(bag,p_to,dst,left('Transfer from '||from_name||' (item '||p_item::text||')'||case when note<>'' then ': '||note else '' end,500),uid);
 insert into public.inspection_draft_revisions(id,tenant_id,bag_id,draft_id,revision,description,category,condition,created_by)
 values(gen_random_uuid(),p_to,bag,draft,1,left(title,1000),left(category,120),'',uid);
 detail:=jsonb_build_object('action','transfer','note',note,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
 insert into public.item_events(id,tenant_id,item_id,kind,detail,actor) values(p_id,p_from,p_item,'period_ended',detail,uid);
 perform komisio_private.record_access(p_from,'item.transferred_out',p_item,jsonb_build_object('to_tenant',p_to,'bag_id',bag));
 perform komisio_private.record_access(p_to,'item.transferred_in',bag,jsonb_build_object('from_tenant',p_from,'item_id',p_item,'draft_id',draft));
 return jsonb_build_object('transferred',true,'replayed',false,'toTenant',p_to,'sellerId',dst,'bagId',bag,'draftId',draft);
end $$;
revoke all on function public.transfer_item(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.transfer_item(uuid,uuid,uuid,uuid,text) to authenticated;
