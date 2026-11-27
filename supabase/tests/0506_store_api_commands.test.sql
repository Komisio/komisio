begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('b0000000-0000-4000-8000-000000000889','api-owner@example.test',now()),
 ('b0000000-0000-4000-8000-000000000890','api-admin@example.test',now());
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000000889","role":"authenticated"}';
select set_config('test.t',public.create_tenant('Store API review','store-api-review',gen_random_uuid())::text,true);
select set_config('test.other',public.create_tenant('Other API store','other-api-store',gen_random_uuid())::text,true);
insert into public.tenant_members(tenant_id,user_id,role) values(current_setting('test.t')::uuid,'b0000000-0000-4000-8000-000000000890','admin');
select public.publish_store_policy(current_setting('test.t')::uuid,gen_random_uuid(),null,(public.current_store_policy(current_setting('test.t')::uuid)->'policy')
 || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full","intakeProfile":"quick"}'::jsonb);
do $$ begin
 perform set_config('test.reader',public.issue_store_inventory_key(current_setting('test.t')::uuid,'Reader'),true);
 perform set_config('test.otherkey',public.issue_store_inventory_key(current_setting('test.other')::uuid,'Other',array['sellers:read','sales:read','returns:read','payouts:read']),true);
 perform set_config('test.key',public.issue_store_inventory_key(current_setting('test.t')::uuid,'Reviewed POS',
 array['items:read','items:write','sellers:read','sellers:write','sales:read','sales:write','returns:read','returns:write','payouts:read']),true);
end $$;
create function pg_temp.submit(action text,body jsonb,subject uuid default null) returns uuid language sql as $$
 select public.submit_store_api_request(current_setting('test.key'),gen_random_uuid(),action,subject,body)
$$;
create function pg_temp.approve(op uuid) returns uuid language plpgsql as $$
declare d public.operation_decisions;
begin
 perform public.decide_operation(current_setting('test.t')::uuid,gen_random_uuid(),op,'approved','Checked against store records');
 select * into strict d from public.operation_decisions where operation_id=op;
 if d.outcome<>'executed' then raise exception 'Approval failed: %',d.error_code; end if;
 return d.result_id;
end $$;
select throws_ok($$select public.store_api_records(current_setting('test.reader'),'sellers',10,null,null)$$,'INSUFFICIENT_SCOPE','inventory grant cannot read seller contacts');
select throws_ok($$select public.submit_store_api_request(current_setting('test.reader'),gen_random_uuid(),'recordSale',null,'{}')$$,'INSUFFICIENT_SCOPE','a read key cannot propose a sale');
select set_config('test.replay',gen_random_uuid()::text,true);
select set_config('test.sop',public.submit_store_api_request(current_setting('test.key'),current_setting('test.replay')::uuid,'createSeller',null,'{"name":"Store Example","phone":"0700000000"}')::text,true);
select is(public.submit_store_api_request(current_setting('test.key'),current_setting('test.replay')::uuid,'createSeller',null,'{"name":"Store Example","phone":"0700000000"}')::text,current_setting('test.sop'),'exact retry returns the same request');
select throws_ok($$select public.submit_store_api_request(current_setting('test.key'),current_setting('test.replay')::uuid,'createSeller',null,'{"name":"Changed","phone":"0700000001"}')$$,'REQUEST_CONFLICT','changed retry refuses a second write');
select is(public.store_api_request_status(current_setting('test.otherkey'),current_setting('test.sop')::uuid),null,'request status is private to the issuing key');
select is(public.store_api_records(current_setting('test.key'),'sellers',10,null,null)->'records','[]'::jsonb,'proposing a change has no committed seller yet');
select throws_ok($$select pg_temp.approve(current_setting('test.sop')::uuid)$$,'42501','FORBIDDEN','issuer cannot approve its own key request');
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000000890","role":"authenticated"}';
select is(public.review_store_api_request(current_setting('test.t')::uuid,current_setting('test.sop')::uuid)->'body'->>'name','Store Example','reviewer sees the exact requested change');
select set_config('test.seller',pg_temp.approve(current_setting('test.sop')::uuid)::text,true);
select is(public.store_api_request_status(current_setting('test.key'),current_setting('test.sop')::uuid)->>'resultId',current_setting('test.seller'),'polling returns executed seller id');
select is((select body from komisio_private.store_api_requests where id=current_setting('test.sop')::uuid),'{}'::jsonb,'terminal receipt omits seller contact data');
select is(public.submit_store_api_request(current_setting('test.key'),current_setting('test.replay')::uuid,'createSeller',null,'{"name":"Store Example","phone":"0700000000"}')::text,current_setting('test.sop'),'retry after approval still resolves to the original receipt');
select set_config('test.srow',(public.store_api_records(current_setting('test.key'),'sellers',10,null,current_setting('test.seller')::uuid)->'records'->0)::text,true);
select is(pg_temp.approve(pg_temp.submit('editSeller',jsonb_build_object('name','Updated name','expectedRevision',(current_setting('test.srow')::jsonb->>'revision')::int),current_setting('test.seller')::uuid))::text,current_setting('test.seller'),'update existing seller with revision');
select is(public.store_api_records(current_setting('test.otherkey'),'sellers',10,null,current_setting('test.seller')::uuid)->'records','[]'::jsonb,'another store has no matching contact');
select set_config('test.agreement',public.publish_seller_agreement(current_setting('test.t')::uuid,gen_random_uuid(),null,'Terms','Synthetic only','en',false)::text,true);
select public.record_agreement_evidence(current_setting('test.t')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,current_setting('test.agreement')::uuid,'Store evidence');
select set_config('test.item',pg_temp.approve(pg_temp.submit('createItem',jsonb_build_object('sellerId',current_setting('test.seller'),'title','Blue coat','priceMinor',50000)))::text,true);
select is(public.read_store_inventory(current_setting('test.key'),1,null,current_setting('test.item')::uuid)->'items'->0->>'title','Blue coat','registration uses the item engine');
select is(pg_temp.approve(pg_temp.submit('editItem','{"title":"Wool coat","expectedTitle":"Blue coat","priceMinor":48000,"expectedPriceMinor":50000,"reason":"Repriced after inspection"}',current_setting('test.item')::uuid))::text,current_setting('test.item'),'correct title and price atomically');
select set_config('test.stale',pg_temp.submit('editItem','{"title":"Should roll back","expectedTitle":"Wool coat","priceMinor":47000,"expectedPriceMinor":50000,"reason":"Stale source"}',current_setting('test.item')::uuid)::text,true);
select public.decide_operation(current_setting('test.t')::uuid,gen_random_uuid(),current_setting('test.stale')::uuid,'approved','Check atomic correction');
select is(public.store_api_request_status(current_setting('test.key'),current_setting('test.stale')::uuid)->>'status','failed','stale price rejects the complete edit');
select is(public.read_store_inventory(current_setting('test.key'),1,null,current_setting('test.item')::uuid)->'items'->0->>'title','Wool coat','earlier title edit rolls back with price conflict');
select set_config('test.sale',pg_temp.approve(pg_temp.submit('recordSale',jsonb_build_object('externalId','E-42','currency','SEK','occurredAt',now(),
 'lines',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceMinor',40000)))))::text,true);
select set_config('test.sale_row',(public.store_api_records(current_setting('test.key'),'sales',1,null,current_setting('test.sale')::uuid)->'records'->0)::text,true);
select is(current_setting('test.sale_row')::jsonb->>'totalMinor','40000','sale records actual discounted price');
select set_config('test.ret',pg_temp.approve(pg_temp.submit('recordReturn',jsonb_build_object('saleLineId',current_setting('test.sale_row')::jsonb->'lines'->0->>'id',
 'refundMinor',40000,'reason','Receipt returned','occurredAt',now())))::text,true);
select is(public.store_api_records(current_setting('test.key'),'returns',1,null,current_setting('test.ret')::uuid)->'records'->0->>'refundMinor','40000','refund adds its own evidence');
select is(pg_temp.approve(pg_temp.submit('endItem','{"endAction":"return","reason":"Collected by seller"}',current_setting('test.item')::uuid))::text,current_setting('test.item'),'end a returned item through lifecycle engine');
select is(public.read_store_inventory(current_setting('test.key'),1,null,current_setting('test.item')::uuid)->'items'->0->>'stage','ended','ending keeps the inventory record');
select is(public.store_api_records(current_setting('test.otherkey'),'sales',10,null,current_setting('test.sale')::uuid)->'records','[]'::jsonb,'other-store sale details are not exposed');
select is(public.store_api_records(current_setting('test.key'),'payouts',1,null,null)->'records','[]'::jsonb,'payout scope exposes no unrequested transfers');
select set_config('test.pending',pg_temp.submit('createSeller','{"name":"Pending","phone":"0700000000"}')::text,true);
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000000889","role":"authenticated"}';
select public.revoke_store_inventory_key(current_setting('test.t')::uuid,(select id from komisio_private.store_inventory_keys where label='Reviewed POS' and tenant_id=current_setting('test.t')::uuid));
set local "request.jwt.claims"='{"sub":"b0000000-0000-4000-8000-000000000890","role":"authenticated"}';
select public.decide_operation(current_setting('test.t')::uuid,gen_random_uuid(),current_setting('test.pending')::uuid,'approved','Check revocation');
select is((select outcome from public.operation_decisions where operation_id=current_setting('test.pending')::uuid),'failed','revocation invalidates unexecuted changes');
select * from finish();
rollback;
