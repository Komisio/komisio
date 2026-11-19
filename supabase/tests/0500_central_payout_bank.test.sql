begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f5000000-0000-4000-8000-000000000001','owner500@example.test',now()),
 ('f5000000-0000-4000-8000-000000000002','seller500@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Central test','central-bank-500',gen_random_uuid()) as central \gset
select create_tenant('Store test','store-bank-500',gen_random_uuid()) as shop \gset
select register_seller(:'central',gen_random_uuid(),'Central seller','seller500@example.test','') as seller \gset
select register_seller(:'shop',gen_random_uuid(),'Shop seller','seller500@example.test','') as shopseller \gset
select adjust_seller_ledger(:'central',gen_random_uuid(),:'seller',60000,'Test credit');
select adjust_seller_ledger(:'shop',gen_random_uuid(),:'shopseller',60000,'Test credit');
select gen_random_uuid() as historic,gen_random_uuid() as fresh \gset
select request_payout(:'central',:'historic',:'seller',30000);
reset role;
update public.platform_settings set central_app_tenant_id=:'central' where only_row;
set local role authenticated;
select is(request_payout(:'central',:'historic',:'seller',30000),:'historic'::uuid,'an existing request replays without bank details');
select throws_like(format('select request_payout(%L,%L,%L,30000)',:'central',:'fresh',:'seller'),'%PAYOUT_BANK_REQUIRED%','staff cannot create a new central request without an account');
set local "request.jwt.claims"='{"sub":"f5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_seller_payouts_page(:'central',:'seller')#>>'{balance,availableOre}','60000','balance readable before bank entry');
select is(my_seller_payouts_page(:'central',:'seller')->'bankAccountMissing','true'::jsonb,'only availability is exposed');
select is(my_seller_payouts_page(:'shop',:'shopseller')->'bankAccountMissing','false'::jsonb,'ordinary store does not require bank entry');
select lives_ok(format('select request_my_payout(%L,%L,%L,30000)',:'shop',gen_random_uuid(),:'shopseller'),'ordinary store still accepts requests without bank details');
select '{"holder":"Test Seller","country":"SE","kind":"local","account":"123456789","routing":"1234"}' as bank \gset
select save_seller_bank_details(:'shop',gen_random_uuid(),:'shopseller',null,:'bank'::jsonb);
select throws_like(format('select request_my_payout(%L,%L,%L,30000)',:'central',:'fresh',:'seller'),'%PAYOUT_BANK_REQUIRED%','account saved at another store is insufficient');
select is(my_seller_payouts_page(:'central',:'seller')->>'total','1','refusal creates no payout');
select save_seller_bank_details(:'central',gen_random_uuid(),:'seller',null,:'bank'::jsonb);
select is(my_seller_payouts_page(:'central',:'seller')->'bankAccountMissing','false'::jsonb,'central account is reusable');
select is(request_my_payout(:'central',:'fresh',:'seller',30000),:'fresh'::uuid,'seller explicitly requests payout after saving');
select is(request_my_payout(:'central',:'fresh',:'seller',30000),:'fresh'::uuid,'retry returns the same ID');
select is(my_seller_payouts_page(:'central',:'seller')->>'total','2','one historical and one new request');
select * from finish();
rollback;
