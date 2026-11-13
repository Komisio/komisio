begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f7900000-0000-4000-8000-000000000001','queue-staff@example.test',now(),null,null),
 ('f7900000-0000-4000-8000-000000000002',null,null,'46700007902',now()),
 ('f7900000-0000-4000-8000-000000000003','queue-reader@example.test',now(),null,null);
set local role authenticated;
set local request.jwt.claims='{"sub":"f7900000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic queue','synthetic-filtered-queue',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f7900000-0000-4000-8000-000000000101',null,'Synthetic terms','Synthetic agreement text','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant','f7900000-0000-4000-8000-000000000003','readonly');
-- Historical fixtures exceed one page; no runtime cap or immutable record is changed.
insert into external_item_requests(id,tenant_id,owner_id,description,brand,condition,notes,currency,photos,created_at,desired_price_ore,price_basis,sender_country)
select ('f7900000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,:'tenant','f7900000-0000-4000-8000-000000000002',
 case when n=31 then 'Blå 100%_ jacka' else 'Varan '||n end,'Nord','good','','SEK',array['f7900000-0000-4000-8000-000000000201']::uuid[],now()-n*interval '1 minute',40000,
 case when n=32 then 'resale' else 'seller_amount' end,'SE'
from generate_series(1,32) n;
set local role authenticated;
select issue_external_item_offer(:'tenant','f7900000-0000-4000-8000-000000000401','f7900000-0000-4000-8000-000000000301',null,40000,100000,'f7900000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7900000-0000-4000-8000-000000000403','f7900000-0000-4000-8000-000000000303',null,40000,100000,'f7900000-0000-4000-8000-000000000101');
select issue_external_item_offer(:'tenant','f7900000-0000-4000-8000-000000000405','f7900000-0000-4000-8000-000000000305',null,40000,100000,'f7900000-0000-4000-8000-000000000101');
select decline_external_item_request(gen_random_uuid(),:'tenant','f7900000-0000-4000-8000-000000000304','Synthetic reason');
reset role;
insert into external_item_offers(id,tenant_id,request_id,owner_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at)
 values('f7900000-0000-4000-8000-000000000402',:'tenant','f7900000-0000-4000-8000-000000000302','f7900000-0000-4000-8000-000000000002',40000,100000,'f7900000-0000-4000-8000-000000000101','f7900000-0000-4000-8000-000000000001',now()-interval '49 hours',now()-interval '1 hour');
set local role authenticated;
set local request.jwt.claims='{"sub":"f7900000-0000-4000-8000-000000000002","role":"authenticated"}';
select respond_external_item_offer(gen_random_uuid(),'f7900000-0000-4000-8000-000000000403',true,'f7900000-0000-4000-8000-000000000101');
select respond_external_item_offer(gen_random_uuid(),'f7900000-0000-4000-8000-000000000405',false,null);
select throws_ok(format($$select external_item_offer_queue_filtered(%L)$$,:'tenant'),'42501',null,'seller cannot read staff filters');
set local request.jwt.claims='{"sub":"f7900000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(external_item_offer_queue_filtered(:'tenant')->>'total','32','readonly sees the full tenant count');
select is(jsonb_array_length(external_item_offer_queue_filtered(:'tenant')->'rows'),25,'reads remain bounded');
select is(external_item_offer_queue_filtered(:'tenant',0,'waiting')->>'total','27','status filter precedes pagination');
select is(jsonb_array_length(external_item_offer_queue_filtered(:'tenant',25,'waiting')->'rows'),2,'older matching rows remain reachable');
select is(external_item_offer_queue_filtered(:'tenant',0,'all','BLÅ')->>'total','1','case-insensitive search reaches an item beyond the first page');
select is(external_item_offer_queue_filtered(:'tenant',0,'waiting','%_')->>'total','1','search treats wildcard characters literally');
select is(external_item_offer_queue_filtered(:'tenant',0,'offered','BLÅ')->>'total','0','text and status compose');
select is(external_item_offer_queue_filtered(:'tenant',0,'waiting','nord')->>'total','27','brand is searchable');
select is(external_item_offer_queue_filtered(:'tenant',0,'expired')->>'total','1','expiry uses the current server deadline');
select is(external_item_offer_queue_filtered(:'tenant',0,'accepted')->>'total','1','accepted without handover stays distinct');
select is(external_item_offer_queue_filtered(:'tenant',0,'offered')->>'total','1','unanswered offers stay distinct');
select is(external_item_offer_queue_filtered(:'tenant',0,'declined')->>'total','1','seller refusal is distinct from staff rejection');
select is(external_item_offer_queue_filtered(:'tenant',0,'rejected')->>'total','1','staff rejection has its own display filter');
select is(external_item_offer_queue_filtered(:'tenant',0,'all','Varan 32')#>>'{rows,0,desired_price_ore}',null::text,'legacy sale-price wishes remain hidden');
select is(external_item_offer_queue_filtered(:'tenant',0,'all','BLÅ')#>>'{rows,0,desired_price_ore}','40000','seller compensation remains exact');
select throws_like(format($$select external_item_offer_queue_filtered(%L,-1)$$,:'tenant'),'%INVALID_INPUT%','offset validated');
select throws_like(format($$select external_item_offer_queue_filtered(%L,0,'unknown')$$,:'tenant'),'%INVALID_INPUT%','status allowlist enforced');
select throws_like(format($$select external_item_offer_queue_filtered(%L,0,'all',repeat('x',121))$$,:'tenant'),'%INVALID_INPUT%','query bounded');
select throws_ok($$select external_item_offer_queue_filtered('f7900000-0000-4000-8000-000000000999')$$,'42501',null,'filters cannot read another tenant');
select is(external_item_offer_queue(:'tenant')->>'total','32','old read contract remains available');
select ok(not has_function_privilege('anon','public.external_item_offer_queue_filtered(uuid,integer,text,text)','execute'),'anonymous callers cannot execute the filtered read');
set local request.jwt.claims='{"sub":"f7900000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f7900000-0000-4000-8000-000000000406','f7900000-0000-4000-8000-000000000302','f7900000-0000-4000-8000-000000000402',40000,100000,'f7900000-0000-4000-8000-000000000101');
select is(external_item_offer_queue_filtered(:'tenant',0,'expired')->>'total','0','a superseded expired offer no longer matches');
select is(external_item_offer_queue_filtered(:'tenant',0,'offered')->>'total','2','only the latest offer determines the display state');
reset role;
select * from finish();
rollback;
