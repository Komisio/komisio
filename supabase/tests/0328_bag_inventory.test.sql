begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('d3280000-0000-4000-8000-000000000001','bag-owner@example.test',now()),
 ('d3280000-0000-4000-8000-000000000002','bag-outsider@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d3280000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.tenant',create_tenant('Synthetic bag store','synthetic-bag-table',gen_random_uuid())::text,true);
select set_config('test.seller',register_seller(current_setting('test.tenant')::uuid,gen_random_uuid(),'Synthetic seller','bag-seller@example.test','')::text,true);
select publish_store_policy(current_setting('test.tenant')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.tenant')::uuid)->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","markdownSteps":[]}'::jsonb);
select set_config('test.bag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',null)::text,true);
select set_config('test.otherbag',receive_bag_with_agreement(current_setting('test.tenant')::uuid,gen_random_uuid(),current_setting('test.seller')::uuid,'',null)::text,true);
do $$ declare draft uuid; session uuid; begin
 for n in 1..27 loop
  draft:=gen_random_uuid();
  perform save_inspection_draft(current_setting('test.tenant')::uuid,gen_random_uuid(),case when n=27 then current_setting('test.otherbag')::uuid else current_setting('test.bag')::uuid end,draft,0,'Synthetic item '||lpad(n::text,2,'0'),'Clothing','Good');
  perform accept_item(current_setting('test.tenant')::uuid,gen_random_uuid(),'inspection_draft',draft,1,20000);
 end loop;
 session:=gen_random_uuid();
 perform create_bag_reception(current_setting('test.tenant')::uuid,session,current_setting('test.seller')::uuid,current_setting('test.bag')::uuid);
 perform quick_receive_from_bag(current_setting('test.tenant')::uuid,gen_random_uuid(),session,current_setting('test.seller')::uuid,0,'{"description":"Synthetic quick item"}',20000,current_setting('test.bag')::uuid);
end $$;
select set_config('test.result',items_search_page(current_setting('test.tenant')::uuid,jsonb_build_object('bag',current_setting('test.bag')),'title','asc',25,0)::text,true);
select is((current_setting('test.result')::jsonb->>'total')::int,27,'both origins counted in this bag only');
select is(jsonb_array_length(current_setting('test.result')::jsonb->'items'),25,'bounded page');
select is(current_setting('test.result')::jsonb->'items'->0->>'title','Synthetic item 01','sort applies before page');
select set_config('test.item',current_setting('test.result')::jsonb->'items'->0->>'id',true);
select set_config('test.last',items_search_page(current_setting('test.tenant')::uuid,jsonb_build_object('bag',current_setting('test.bag')),'title','asc',25,25)::text,true);
select is(jsonb_array_length(current_setting('test.last')::jsonb->'items'),2,'remaining page');
select is(current_setting('test.last')::jsonb->'items'->1->>'originKind','reception_review','quick item included');
select ok(not exists(select 1 from jsonb_array_elements(current_setting('test.last')::jsonb->'items') i where i->>'title'='Synthetic item 27'),'other bag excluded');
select ok(current_setting('test.result')::jsonb->'items'->0 ?& array['classification','sync','defaultPhotoId','sellerId'],'shared projection contains editing and status facts');
select record_sale(current_setting('test.tenant')::uuid,gen_random_uuid(),'manual','Synthetic sale',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',current_setting('test.item'),'priceOre',15000)));
select is(items_search_page(current_setting('test.tenant')::uuid,jsonb_build_object('bag',current_setting('test.bag'),'stage','sold'),'title','asc',25,0)->'items'->0->>'currentPriceOre','15000','sold item retains actual sale price');
select throws_ok($$select items_search_page(current_setting('test.tenant')::uuid,'{"bag":"bad"}','title','asc',25,0)$$,'P0001','INVALID_INPUT','invalid scope rejected');
select throws_ok($$select items_search_page(current_setting('test.tenant')::uuid,jsonb_build_object('bag',gen_random_uuid()),'title','asc',25,0)$$,'P0001','BAG_NOT_FOUND','missing or foreign bag never becomes unscoped');
set local "request.jwt.claims"='{"sub":"d3280000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select items_search_page(current_setting('test.tenant')::uuid,jsonb_build_object('bag',current_setting('test.bag')),'title','asc',25,0)$$,'42501','FORBIDDEN','outsider cannot read inventory');
select * from finish();
rollback;
