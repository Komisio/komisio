begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('d1740000-0000-4000-8000-000000000001','workspace-sale@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"d1740000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Workspace sale','workspace-sale',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant',gen_random_uuid(),'Synthetic seller','','123') as seller \gset
select publish_store_policy(:'tenant',gen_random_uuid(),null,(current_store_policy(:'tenant')->'policy') || '{"vatModeConsignmentPrivate":"consignment_margin","vatModeStoreOwned":"store_full"}'::jsonb);
select receive_bag_with_agreement(:'tenant',gen_random_uuid(),:'seller','Synthetic',null) as bag \gset
select gen_random_uuid() as draft, gen_random_uuid() as item \gset
select save_inspection_draft(:'tenant',gen_random_uuid(),:'bag',:'draft',0,'Synthetic chair','','Good');
select accept_item(:'tenant',:'item','inspection_draft',:'draft',1,20000);
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','on_sale','unsold item keeps lifecycle stage');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'priceOre','20000','unsold current price remains');
select ok((seller_workspace_items(:'tenant',:'seller')->'items'->0) ? 'soldPriceOre','sale field exists during full rollout');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'soldPriceOre',null,'unsold has no sale price');
select gen_random_uuid() as sale \gset
select record_sale(:'tenant',:'sale','manual','Synthetic-workspace-sale',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',15000)));
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','sold','active completed sale is sold');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'soldPriceOre','15000','sale price differs from list price');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'priceOre','20000','list price retained independently');
select is(seller_workspace_items(:'tenant',:'seller')->>'total','1','sale does not change workspace membership');
select record_return(:'tenant',gen_random_uuid(),(select id from sale_lines where tenant_id=:'tenant' and sale_id=:'sale'),15000,'Synthetic full return');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','on_sale','return follows existing lifecycle');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'soldPriceOre',null,'returned sale is excluded');
select gen_random_uuid() as resale \gset
select record_sale(:'tenant',:'resale','manual','Synthetic-workspace-resale',now(),'SEK',jsonb_build_array(jsonb_build_object('itemId',:'item','priceOre',17000)));
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'soldPriceOre','17000','resale uses the new active sale');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','sold','resale is sold');
select record_return(:'tenant',gen_random_uuid(),(select id from sale_lines where tenant_id=:'tenant' and sale_id=:'resale'),17000,'Synthetic second return');
select end_sale_period(:'tenant',gen_random_uuid(),:'item','charity','Synthetic end');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'stage','ended','ended item keeps lifecycle stage');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'soldPriceOre',null,'ended returned item has no active sale');
select is(seller_workspace_items(:'tenant',:'seller')->'items'->0->>'priceOre','20000','ended item retains current price');
select register_seller(:'tenant',gen_random_uuid(),'Empty synthetic seller','','456') as other_seller \gset
select is(jsonb_array_length(seller_workspace_items(:'tenant',:'other_seller')->'items'),0,'another seller never receives this sale');
select create_tenant('Other workspace sale','other-workspace-sale',gen_random_uuid()) as other_tenant \gset
select throws_like(format('select seller_workspace_items(%L,%L)',:'other_tenant',:'seller'),'%SELLER_NOT_FOUND%','same owner cannot read a seller under another store');
select * from finish();
rollback;
