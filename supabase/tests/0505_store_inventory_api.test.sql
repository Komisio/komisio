begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000889','inventory-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000890','inventory-staff@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000889","role":"authenticated"}';
select set_config('test.a',create_tenant('Inventory A','api-inventory-a',gen_random_uuid())::text,true);
select set_config('test.b',create_tenant('Inventory B','api-inventory-b',gen_random_uuid())::text,true);
select publish_store_policy(current_setting('test.a')::uuid,gen_random_uuid(),null,
 (current_store_policy(current_setting('test.a')::uuid)->'policy') || '{"vatModeStoreOwned":"store_full"}'::jsonb);
do $$ declare t uuid; p uuid; i uuid; n int; begin
 for n in 1..3 loop
  t:=current_setting(case when n<3 then 'test.a' else 'test.b' end)::uuid;
  p:=gen_random_uuid();
  i:=('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  perform register_purchase(t,p,'Wool jacket',1000,'Test receipt',false);
  perform accept_item(t,i,'purchase',p,null,50000);
 end loop;
 perform set_config('test.key',issue_store_inventory_key(current_setting('test.a')::uuid,'Shop site'),true);
 perform set_config('test.key_id',store_inventory_keys(current_setting('test.a')::uuid)->0->>'id',true);
end $$;
select record_sale(current_setting('test.a')::uuid,gen_random_uuid(),'manual','api-889-sale',now(),'SEK',
 '[{"itemId":"e0000000-0000-4000-8000-000000000001","priceOre":40000}]');
select is(store_inventory_keys(current_setting('test.a')::uuid)->0->>'label','Shop site','owner sees credential metadata');
select ok(not (store_inventory_keys(current_setting('test.a')::uuid)->0 ?| array['secret','secret_hash']),'metadata omits the credential');

reset role;
insert into tenant_members(tenant_id,user_id,role) values(current_setting('test.a')::uuid,'f0000000-0000-4000-8000-000000000890','staff');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000890","role":"authenticated"}';
select throws_ok($$select issue_store_inventory_key(current_setting('test.a')::uuid,'x')$$,'42501','FORBIDDEN','staff cannot issue a key');
select throws_ok($$select revoke_store_inventory_key(current_setting('test.a')::uuid,current_setting('test.key_id')::uuid)$$,'42501','FORBIDDEN','staff cannot revoke a key');

reset role;
select ok(not has_table_privilege('anon','komisio_private.store_inventory_keys','select'),'credentials are private');
set local role anon;
set local "request.jwt.claims"='{}';
select ok(not has_function_privilege('anon','public.issue_store_inventory_key(uuid,text,text[])','execute'),'anonymous callers cannot issue keys');
select throws_ok($$select read_store_inventory(null,50,null,null)$$,'INVALID_KEY','missing key is refused');
select throws_ok($$select read_store_inventory('kmi_'||repeat('0',64),50,null,null)$$,'INVALID_KEY','unknown key is refused');
select throws_ok($$select read_store_inventory(current_setting('test.key'),101,null,null)$$,'INVALID_INPUT','page size is bounded in the database');
select set_config('test.page',read_store_inventory(current_setting('test.key'),1,null,null)::text,true);
select is(current_setting('test.page')::jsonb->>'nextCursor','e0000000-0000-4000-8000-000000000001','more rows produce a cursor');
select is(current_setting('test.page')::jsonb->'items'->0->>'priceMinor','50000','catalogue price survives a discounted sale');
select is(current_setting('test.page')::jsonb->'items'->0->>'stage','sold','stage reflects the completed sale');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('test.page')::jsonb->'items'->0) k),
 array['category','currency','id','priceMinor','stage','title'],'only documented inventory fields are returned');
select set_config('test.page2',read_store_inventory(current_setting('test.key'),1,(current_setting('test.page')::jsonb->>'nextCursor')::uuid,null)::text,true);
select is(current_setting('test.page2')::jsonb->'items'->0->>'id','e0000000-0000-4000-8000-000000000002','cursor resumes at next item');
select is(current_setting('test.page2')::jsonb->>'nextCursor',null,'last page has no cursor');
select is(read_store_inventory(current_setting('test.key'),50,null,'e0000000-0000-4000-8000-000000000003')->'items','[]'::jsonb,'cannot read an item in the other store even when the issuer owns both');
reset role;
update komisio_private.store_inventory_keys set window_start=date_trunc('minute',statement_timestamp()),requests=60 where id=current_setting('test.key_id')::uuid;
select throws_ok($$select read_store_inventory(current_setting('test.key'),1,null,null)$$,'RATE_LIMIT','minute budget enforced');
update komisio_private.store_inventory_keys set requests=0,expires_at=now()-interval '1 day' where id=current_setting('test.key_id')::uuid;
select throws_ok($$select read_store_inventory(current_setting('test.key'),1,null,null)$$,'INVALID_KEY','expired key is refused');
update komisio_private.store_inventory_keys set expires_at=now()+interval '1 day' where id=current_setting('test.key_id')::uuid;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000889","role":"authenticated"}';
select revoke_store_inventory_key(current_setting('test.a')::uuid,current_setting('test.key_id')::uuid);
reset role;
select throws_ok($$select read_store_inventory(current_setting('test.key'),1,null,null)$$,'INVALID_KEY','revocation takes effect on next request');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values(gen_random_uuid(),'f0000000-0000-4000-8000-000000000889','totp','verified',now(),now());
set local role authenticated;
select throws_ok($$select issue_store_inventory_key(current_setting('test.a')::uuid,'x')$$,'42501','FORBIDDEN','issuer must satisfy current MFA');
select * from finish();
rollback;
