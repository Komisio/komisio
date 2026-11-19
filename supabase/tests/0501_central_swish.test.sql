begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f5010000-0000-4000-8000-000000000001','staff501@example.test',now()),
 ('f5010000-0000-4000-8000-000000000002','seller501@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f5010000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Central sample','central-swish-501',gen_random_uuid()) as central \gset
select create_tenant('Independent sample','shop-swish-501',gen_random_uuid()) as shop \gset
select register_seller(:'central',gen_random_uuid(),'Seller','seller501@example.test','') as seller \gset
select register_seller(:'shop',gen_random_uuid(),'Seller','seller501@example.test','') as other \gset
select adjust_seller_ledger(:'central',gen_random_uuid(),:'seller',90000,'Test credit');
reset role;
update public.platform_settings set central_app_tenant_id=:'central' where only_row;
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f5010000-0000-4000-8000-000000000002","role":"authenticated"}';
select gen_random_uuid() as request, gen_random_uuid() as bankrequest, gen_random_uuid() as account \gset
select '{"method":"swish","phone":"+46700000001"}'::jsonb as swish \gset
select is(my_seller_payouts_page(:'central',:'seller')#>>'{centralPayout,enabled}','true','central SEK is eligible');
select ok(my_seller_payouts_page(:'shop',:'other')->'centralPayout' is null,'normal store has no central choices');
select throws_like(format('select request_central_payout(%L,%L,%L,30000,%L)',:'shop',:'request',:'other',:'swish'),'%FORBIDDEN%','ordinary store cannot submit a Swish request');
select throws_like(format('select request_central_payout(%L,%L,%L,30000,%L)',:'central',:'request',:'seller','{"method":"swish","phone":"+46800000000"}'),'%INVALID_INPUT%','landline rejected');
select throws_like(format('select request_central_payout(%L,%L,%L,900000,%L)',:'central',:'request',:'seller',:'swish'),'%PAYOUT_EXCEEDS_BALANCE%','failed new request rolls back its instruction');
select is(request_central_payout(:'central',:'request',:'seller',30000,:'swish'),:'request'::uuid,'request Swish without bank details');
select is(request_central_payout(:'central',:'request',:'seller',30000,:'swish'),:'request'::uuid,'exact Swish retry');
select throws_like(format('select request_central_payout(%L,%L,%L,30000,%L)',:'central',:'request',:'seller','{"method":"swish","phone":"+46700000002"}'),'%REQUEST_CONFLICT%','retry cannot redirect an existing request');
select is(my_seller_payouts_page(:'central',:'seller')#>>'{centralPayout,suggestedPhone}','+46700000001','seller can reuse the number');
select '{"holder":"Test","country":"SE","kind":"local","account":"123456789","routing":"1234"}' as bank \gset
select save_seller_bank_details(:'central',:'account',:'seller',null,:'bank'::jsonb);
select jsonb_build_object('method','bank','bankVersionId',:'account') as dest \gset
select is(request_central_payout(:'central',:'bankrequest',:'seller',30000,:'dest'),:'bankrequest'::uuid,'bank transfer uses chosen saved account');
select save_seller_bank_details(:'central',gen_random_uuid(),:'seller',:'account',jsonb_set(:'bank'::jsonb,'{account}','"987654321"'));
select is(request_central_payout(:'central',:'bankrequest',:'seller',30000,:'dest'),:'bankrequest'::uuid,'retry after account change retains original destination');
select throws_like(format('select request_central_payout(%L,%L,%L,30000,%L)',:'central',gen_random_uuid(),:'seller',:'dest'),'%BANK_DETAILS_CHANGED%','new request cannot use a stale bank selection');
select throws_like(format('select payout_bank_details(%L,%L)',:'central',:'request'),'%FORBIDDEN%','seller cannot access staff instruction lookup');
set local "request.jwt.claims"='{"sub":"f5010000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(payout_bank_details(:'central',:'request')->>'swishPhone','+46700000001','staff sees original Swish destination');
select is(payout_bank_details(:'central',:'bankrequest')#>>'{current,id}',:'account','staff sees original bank version');
select throws_like(format('select approve_payout(%L,%L,%L)',:'central',gen_random_uuid(),:'bankrequest'),'%PAYOUT_BANK_REVIEW_REQUIRED%','bank option retains review');
select review_payout_bank_details(:'central',gen_random_uuid(),:'bankrequest',:'account');
select lives_ok(format('select approve_payout(%L,%L,%L)',:'central',gen_random_uuid(),:'bankrequest'),'reviewed bank instruction can be approved');
select lives_ok(format('select approve_payout(%L,%L,%L)',:'central',gen_random_uuid(),:'request'),'Swish is independent of saved bank account');
select is(seller_balance(:'central',:'seller')->>'paidOre','0','no automatic payment');
select * from finish();
rollback;
