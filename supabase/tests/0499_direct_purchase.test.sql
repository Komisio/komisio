begin;
select no_plan();
create function pg_temp.uid(n bigint) returns uuid language sql immutable as $$ select ('f4950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,email,email_confirmed_at) values
(pg_temp.uid(1),'fixed-staff@example.test',now()),(pg_temp.uid(2),'fixed-seller@example.test',now()),
(pg_temp.uid(3),'fixed-other@example.test',now()),(pg_temp.uid(4),'fixed-reader@example.test',now());
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select create_tenant('Synthetic central fixed price','synthetic-central-fixed-price',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic ordinary store','synthetic-fixed-ordinary',gen_random_uuid()) as other \gset
select publish_seller_agreement(:'tenant',pg_temp.uid(10),null,'Terms 1','Synthetic terms','sv',true);
select publish_store_policy(:'tenant',gen_random_uuid(),(current_store_policy(:'tenant')->>'id')::uuid,(current_store_policy(:'tenant')->'policy') || '{"vatModeStoreOwned":"store_full"}'::jsonb);
reset role;
update platform_settings set central_app_tenant_id=:'tenant';
insert into tenant_members(tenant_id,user_id,role) values(:'tenant',pg_temp.uid(4),'readonly');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select is(read_central_intake_profile()->'account','null'::jsonb,'new seller has no account');
select throws_like(format($$select save_central_intake_profile(%L,%L,%L,-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',false)$$,pg_temp.uid(20),:'tenant',pg_temp.uid(10)),'%AGREEMENT_REQUIRED%','first use requires explicit consent');
select is(save_central_intake_profile(pg_temp.uid(20),:'tenant',pg_temp.uid(10),-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',true),pg_temp.uid(20),'profile and terms saved without bank');
select lives_ok(format($$select save_central_intake_profile(%L,%L,%L,-1,'{"street":"Test street 1","postalCode":"12345","city":"Test city"}','{"firstName":"Test","lastName":"Seller","phone":"+46700000002"}',true)$$,pg_temp.uid(20),:'tenant',pg_temp.uid(10)),'exact profile retry');
select is(read_central_intake_profile()->>'agreementAccepted','true','consent reused');
select is(read_central_intake_profile()#>>'{account,contact,firstName}','Test','contact visible');
select read_central_intake_profile()#>>'{account,sellerId}' as seller \gset
select reserve_external_item_photo(pg_temp.uid(100),repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(100)||'.jpg');
select throws_like(format($$select submit_central_item_request(%L,%L,'Dress','','good','',null,'SEK',array[%L]::uuid[],'SE','seller_amount',%L)$$,pg_temp.uid(101),:'tenant',pg_temp.uid(100),pg_temp.uid(10)),'%PRICE_REQUIRED%','seller amount mandatory');
select is(submit_central_item_request(pg_temp.uid(101),:'tenant','Dress','','good','',60000,'SEK',array[pg_temp.uid(100)],'SE','seller_amount',pg_temp.uid(10)),pg_temp.uid(101),'fixed amount submitted');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select reserve_external_item_photo(pg_temp.uid(110),repeat('b',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(110)||'.jpg');
select is(submit_central_item_request(pg_temp.uid(111),:'tenant','Jacket','','good','',70000,'SEK',array[pg_temp.uid(110)],'SE','seller_amount',pg_temp.uid(10),'direct_purchase'),pg_temp.uid(111),'explicit direct purchase');
select is(my_external_item_requests_page(0,pg_temp.uid(111),'all')#>>'{requests,0,sale_method}','direct_purchase','seller sees binding selection');
select throws_like(format($$select submit_central_item_request(%L,%L,'Jacket','','good','',70000,'SEK',array[%L]::uuid[],'SE','seller_amount',%L)$$,pg_temp.uid(111),:'tenant',pg_temp.uid(110),pg_temp.uid(10)),'%REQUEST_CONFLICT%','legacy retry cannot change direct purchase to consignment');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,false)$$,:'tenant',pg_temp.uid(111),pg_temp.uid(301)),'%FORBIDDEN%','seller cannot confirm inspection');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select approve_central_item_request(:'tenant',pg_temp.uid(201),pg_temp.uid(101),100000);
select approve_central_item_request(:'tenant',pg_temp.uid(211),pg_temp.uid(111),110000);
select is(read_external_item_offer(pg_temp.uid(211))->>'saleMethod','direct_purchase','offer retains direct terms');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,false)$$,:'tenant',pg_temp.uid(111),pg_temp.uid(301)),'%REQUEST_CHANGED%','no purchase on photo approval');
select receive_handover(:'tenant',pg_temp.uid(402),(read_external_item_offer(pg_temp.uid(201))#>>'{handover,id}')::uuid,'staff_receipt','');
select receive_handover(:'tenant',pg_temp.uid(401),(read_external_item_offer(pg_temp.uid(211))#>>'{handover,id}')::uuid,'staff_receipt','');
select ok(read_external_item_offer(pg_temp.uid(211))->'guarantee'='null'::jsonb,'direct item never enters day 45 processing');
select ok(read_external_item_offer(pg_temp.uid(201))#>>'{guarantee,dueAt}' is not null,'consignment retains deadline');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','0','arrival alone credits neither item');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,true)$$,:'tenant',pg_temp.uid(101),pg_temp.uid(301)),'%REQUEST_CHANGED%','ordinary commission choice cannot be converted');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,true)$$,:'other',pg_temp.uid(111),pg_temp.uid(301)),'%FORBIDDEN%','other tenant cannot confirm');
select inspect_central_direct_purchase(:'tenant',pg_temp.uid(111),pg_temp.uid(301),true) as purchase \gset
select is(inspect_central_direct_purchase(:'tenant',pg_temp.uid(111),pg_temp.uid(301),true),:'purchase'::uuid,'retry returns same purchase');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,false)$$,:'tenant',pg_temp.uid(111),pg_temp.uid(301)),'%REQUEST_CONFLICT%','cannot change purchase evidence on retry');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','70000','seller can request the full agreed amount once');
select is(seller_balance(:'tenant',:'seller')->>'paidOre','0','purchase does not claim bank payment');
select is((select purchase_price_ore from purchase_receipts where id=:'purchase'),70000::bigint,'owned inventory purchase uses agreed amount');
select ok(read_external_item_offer(pg_temp.uid(211))->>'purchaseCreditedAt' is not null,'credit date is available to seller');
select is(central_request_queue(:'tenant',0,'acquired','Jacket',null)#>>'{rows,0,direct_purchase_id}',:'purchase','staff can find owned purchase');
select is(accept_item(:'tenant',pg_temp.uid(510),'purchase',:'purchase',null,110000),pg_temp.uid(510),'purchase registers as store owned inventory');
select ok((select ownership='store' and seller_id is null from items where id=pg_temp.uid(510)),'store owns the item without a second seller claim');
select throws_like(format($$select inspect_central_direct_purchase(%L,%L,%L,true)$$,:'tenant',pg_temp.uid(111),pg_temp.uid(398)),'%REQUEST_CONFLICT%','second command cannot purchase again');
select is(record_sale(:'tenant',pg_temp.uid(511),'manual','direct-resale',clock_timestamp(),'SEK',jsonb_build_array(jsonb_build_object('itemId',pg_temp.uid(510),'priceOre',90000))),pg_temp.uid(511),'owned item can be resold at another price');
select is(seller_balance(:'tenant',:'seller')->>'availableOre','70000','resale does not credit seller again');
select record_return(:'tenant',pg_temp.uid(512),(select id from sale_lines where sale_id=pg_temp.uid(511)),90000,'Synthetic return',clock_timestamp());
select is(seller_balance(:'tenant',:'seller')->>'availableOre','70000','customer return leaves original purchase credit intact');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select is(my_external_item_requests_page(0,pg_temp.uid(111),'history')#>>'{requests,0,lifecycleStatus}','acquired','seller sees acquisition and a freed place');
select * from finish(); rollback;
