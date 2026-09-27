begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Parity of the two bag reads after the scan rewrite (20260927194000): the
-- previous definitions are captured here verbatim, under a schema that the
-- rollback removes, and every result is compared with them and with values
-- the fixture makes independently known.
create schema pgtap_old;
create function pgtap_old.bag_work_summary(p_tenant uuid,p_bag uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare accepted integer; drafts integer; receptions integer; next_draft uuid; next_reception uuid;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant and (
  (i.origin_kind='inspection_draft' and exists(select 1 from public.inspection_current d where d.tenant_id=p_tenant and d.bag_id=p_bag and d.draft_id=i.origin_id))
  or (i.origin_kind='reception_review' and exists(select 1 from public.reception_sessions s where s.tenant_id=p_tenant and s.bag_id=p_bag and s.id=i.origin_id))
 );
 select count(*)::int,(array_agg(d.draft_id order by d.saved_at,d.draft_id))[1] into drafts,next_draft
 from public.inspection_current d where d.tenant_id=p_tenant and d.bag_id=p_bag and not d.archived
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id);
 select count(*)::int,(array_agg(q.session_id order by q.created_at,q.session_id))[1] into receptions,next_reception
 from public.reception_queue_facts(p_tenant,null,null,null,null,p_bag) q
 where q.stage not in ('accepted','declined')
 and not exists(select 1 from public.items i where i.tenant_id=p_tenant and i.origin_kind='reception_review' and i.origin_id=q.session_id);
 return jsonb_build_object('accepted',accepted,'drafts',drafts,'receptions',receptions,'nextDraft',next_draft,'nextReception',next_reception);
end $$;
-- The old list is security definer in production; the copy is too, so komisio_private calls resolve the same way.
create function pgtap_old.bag_registered_items_page(p_tenant uuid,p_bag uuid,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare skip integer:=coalesce(p_offset,0); rows jsonb; total integer;
begin
 perform komisio_private.require_identity();
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip<0 then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.bag_receipts where tenant_id=p_tenant and id=p_bag) then raise exception 'BAG_NOT_FOUND'; end if;
 with scan as (
  select i.id,s.id as session_id,i.accepted_at
  from public.reception_sessions s join public.items i on i.tenant_id=s.tenant_id and i.origin_kind='reception_review' and i.origin_id=s.id
  where s.tenant_id=p_tenant and s.bag_id=p_bag
  union all
  select i.id,null::uuid as session_id,i.accepted_at
  from public.inspection_current d join public.items i on i.tenant_id=d.tenant_id and i.origin_kind='inspection_draft' and i.origin_id=d.draft_id
  where d.tenant_id=p_tenant and d.bag_id=p_bag
 ), page as (select * from scan order by accepted_at desc,id limit 25 offset skip)
 select count(*)::int,coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'session_id',p.session_id,'title',komisio_private.item_title(p_tenant,p.id)->>'title',
  'price_ore',(select price_ore::text from public.item_prices where tenant_id=p_tenant and item_id=p.id order by seq desc limit 1),
  'photo_id',(select e->>'id' from public.reception_source_revisions r cross join lateral jsonb_array_elements(r.sources) e where r.tenant_id=p_tenant and r.session_id=p.session_id and e->>'kind'='photo' order by r.revision desc,e->>'id' limit 1)
 ) order by p.accepted_at desc,p.id) from page p),'[]'::jsonb) into total,rows from scan;
 return jsonb_build_object('items',rows,'total',total,'offset',skip);
end $$;
grant usage on schema pgtap_old to authenticated;
grant execute on function pgtap_old.bag_work_summary(uuid,uuid),pgtap_old.bag_registered_items_page(uuid,uuid,integer) to authenticated;

insert into auth.users(id,email,email_confirmed_at) values
('d1630000-0000-4000-8000-000000009901','parity-owner@example.test',now()),
('d1630000-0000-4000-8000-000000009902','parity-reader@example.test',now()),
('d1630000-0000-4000-8000-000000009903','parity-other@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1630000-0000-4000-8000-000000009901","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Parity store','parity-store',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','','123')::text,true);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Parity',null)::text,true);
select set_config('test.otherbag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'Other',null)::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
-- Empty bags agree before any work exists.
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid),pgtap_old.bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid),'empty summary parity');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0),pgtap_old.bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0),'empty list parity');

-- The bag: two quick items; one accepted draft; one accepted draft archived afterwards;
-- one unaccepted draft with three revisions; one archived unaccepted draft; one pending reception.
select set_config('test.q1',gen_random_uuid()::text,true); select set_config('test.q2',gen_random_uuid()::text,true);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.q1')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
select quick_receive_from_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.q1')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Quick one"}',10001,current_setting('test.bag')::uuid);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.q2')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
select quick_receive_from_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.q2')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Quick two"}',10002,current_setting('test.bag')::uuid);
select set_config('test.da',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.da')::uuid,0,'Accepted draft','','Good');
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',current_setting('test.da')::uuid,1,20001);
select set_config('test.dx',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.dx')::uuid,0,'Accepted then archived','','Good');
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',current_setting('test.dx')::uuid,1,20002);
select set_inspection_archived(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.dx')::uuid,1,true,'Synthetic archive after acceptance');
select set_config('test.du',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.du')::uuid,0,'Unaccepted','','Good');
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.du')::uuid,1,'Unaccepted again','','Good');
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.du')::uuid,2,'Unaccepted thrice','','Good');
select set_config('test.dz',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.dz')::uuid,0,'Archived unaccepted','','Good');
select set_inspection_archived(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.bag')::uuid,current_setting('test.dz')::uuid,1,true,'Synthetic archive');
select set_config('test.pending',gen_random_uuid()::text,true);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.pending')::uuid,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
-- Elsewhere in the store: the other bag has a quick item and an accepted draft; a purchase belongs to no bag.
select set_config('test.qo',gen_random_uuid()::text,true);
select create_bag_reception(current_setting('test.tenant')::uuid,current_setting('test.qo')::uuid,current_setting('test.seller')::uuid,current_setting('test.otherbag')::uuid);
select quick_receive_from_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.qo')::uuid,current_setting('test.seller')::uuid,0,'{"description":"Other quick"}',10003,current_setting('test.otherbag')::uuid);
select set_config('test.do',gen_random_uuid()::text,true);
select save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.otherbag')::uuid,current_setting('test.do')::uuid,0,'Other draft','','Good');
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',current_setting('test.do')::uuid,1,20003);
select set_config('test.purchase',register_purchase(current_setting('test.tenant')::uuid,gen_random_uuid(),'',15000,'Synthetic receipt',false)::text,true);
select accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'purchase',current_setting('test.purchase')::uuid,null,20000);

-- Independently known values.
select set_config('test.s',bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)::text,true);
select is(current_setting('test.s')::jsonb->>'accepted','4','two quick items and two accepted drafts, the archived one included');
select is(current_setting('test.s')::jsonb->>'drafts','1','one unaccepted active draft; its revisions count once; the archived one does not');
select is(current_setting('test.s')::jsonb->>'nextDraft',current_setting('test.du'),'the unaccepted draft is the next draft');
select is(current_setting('test.s')::jsonb->>'receptions','1','one pending reception');
select is(current_setting('test.s')::jsonb->>'nextReception',current_setting('test.pending'),'and it is the next reception');
select set_config('test.l',bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)::text,true);
select is(current_setting('test.l')::jsonb->>'total','4','the list counts the same four');
select is((select count(*)::int from jsonb_array_elements(current_setting('test.l')::jsonb->'items') x where x->>'session_id' is null),2,'two draft-origin rows without a session');
select is((select count(*)::int from jsonb_array_elements(current_setting('test.l')::jsonb->'items') x where x->>'title'='Accepted then archived'),1,'the archived accepted draft is listed');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid,0)->>'total','2','the other bag lists only its own two');
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid)->>'accepted','2','and its summary agrees');

-- Parity with the captured previous definitions, both bags, both pages.
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid),pgtap_old.bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid),'summary parity for the bag');
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid),pgtap_old.bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid),'summary parity for the other bag');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0),pgtap_old.bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0),'list parity page 1');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,25),pgtap_old.bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,25),'list parity past the end');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid,0),pgtap_old.bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.otherbag')::uuid,0),'list parity for the other bag');
-- The rewrite is what it claims: neither body reads the view any more, and the index they rely on exists.
select ok(pg_get_functiondef('public.bag_work_summary(uuid,uuid)'::regprocedure) not like '%inspection_current%','summary no longer reads inspection_current');
select ok(pg_get_functiondef('public.bag_registered_items_page(uuid,uuid,integer)'::regprocedure) not like '%inspection_current%','list no longer reads inspection_current');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='inspection_bag'),'the bag index the rewrite relies on exists');

-- Boundaries are unchanged.
select throws_like($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,-1)$$,'%INVALID_INPUT%','negative offset still refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.tenant')::uuid,'d1630000-0000-4000-8000-000000009902','readonly');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1630000-0000-4000-8000-000000009902","role":"authenticated"}';
select is(bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)->>'accepted','4','readonly reads the summary');
select is(bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)->>'total','4','readonly reads the list');
set local "request.jwt.claims"='{"sub":"d1630000-0000-4000-8000-000000009903","role":"authenticated"}';
select set_config('test.tenant_b',create_tenant('Parity other store','parity-other-store',gen_random_uuid())::text,true);
select throws_ok($$select bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)$$,'42501',null,'another store''s owner is refused the summary');
select throws_ok($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)$$,'42501',null,'another store''s owner is refused the list');
select throws_like($$select bag_registered_items_page(current_setting('test.tenant_b')::uuid,current_setting('test.bag')::uuid,0)$$,'%BAG_NOT_FOUND%','the bag is not found under another store');
reset role;
select ok(not has_function_privilege('anon','public.bag_work_summary(uuid,uuid)','execute'),'anonymous summary denied');
select ok(not has_function_privilege('anon','public.bag_registered_items_page(uuid,uuid,integer)','execute'),'anonymous list denied');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'d1630000-0000-4000-8000-000000009901','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1630000-0000-4000-8000-000000009901","role":"authenticated","aal":"aal1"}';
select throws_ok($$select bag_work_summary(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid)$$,'42501',null,'MFA still enforced for the summary');
select throws_ok($$select bag_registered_items_page(current_setting('test.tenant')::uuid,current_setting('test.bag')::uuid,0)$$,'42501',null,'MFA still enforced for the list');
reset role;
select * from finish(); rollback;
