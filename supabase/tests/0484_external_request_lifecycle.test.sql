begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f8400000-0000-4000-8000-000000000001','lifecycle-staff@example.test',now(),null,null),
 ('f8400000-0000-4000-8000-000000000002','f8400000-0000-4000-8000-000000000002@example.test',now(),'46700008402',now()),
 ('f8400000-0000-4000-8000-000000000003','f8400000-0000-4000-8000-000000000003@example.test',now(),'46700008403',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000001","role":"authenticated"}';
select create_tenant('Synthetic request lifecycle','synthetic-request-lifecycle',gen_random_uuid()) as tenant \gset
select publish_seller_agreement(:'tenant','f8400000-0000-4000-8000-000000000101',null,'Synthetic terms','Synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
set local role authenticated;
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000002","role":"authenticated"}';
select reserve_external_item_photo('f8400000-0000-4000-8000-000000000201',repeat('a',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos','f8400000-0000-4000-8000-000000000002/f8400000-0000-4000-8000-000000000201.jpg');
create function pg_temp.submit_request(p_tenant uuid,p_id uuid) returns uuid language sql as $$
 select submit_external_item_request(p_id,p_tenant,'Jacket','','good','',30000,'SEK',array['f8400000-0000-4000-8000-000000000201']::uuid[],'SE','seller_amount');
$$;
select pg_temp.submit_request(:'tenant',('f8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) from generate_series(301,330) n;
select is(my_external_item_requests()->>'activeCount','30','thirty requests are accepted');
select is(my_external_item_requests()->>'activeLimit','30','server publishes the current cap');
select throws_like(format('select pg_temp.submit_request(%L,gen_random_uuid())',:'tenant'),'%ACTIVE_REQUEST_LIMIT%','thirty-first request is blocked');
select lives_ok(format('select pg_temp.submit_request(%L,%L)',:'tenant','f8400000-0000-4000-8000-000000000301'),'exact replay still succeeds at capacity');
select is(my_external_item_requests_page(0,null,'active')->>'hasMore','true','active pagination is computed after filtering');
select is(jsonb_array_length(my_external_item_requests_page(25,null,'active')->'requests'),5,'second active page is available');
select is(jsonb_array_length(my_external_item_requests_page(0,null,'history')->'requests'),0,'waiting requests never enter history by age');
select withdraw_external_item_request('f8400000-0000-4000-8000-000000000501','f8400000-0000-4000-8000-000000000301');
select lives_ok($$select withdraw_external_item_request('f8400000-0000-4000-8000-000000000501','f8400000-0000-4000-8000-000000000301')$$,'withdrawal retries without duplicating evidence');
select is(my_external_item_requests()->>'activeCount','29','withdrawal frees exactly one slot');
select is(my_external_item_requests_page(0,null,'history')#>>'{requests,0,lifecycleStatus}','withdrawn','history explains a withdrawal');
select is(my_external_item_requests(0,'f8400000-0000-4000-8000-000000000301')#>>'{requests,0,status}','declined','legacy list remains parseable');
select throws_like($$select discard_external_item_photo('f8400000-0000-4000-8000-000000000201')$$,'%PHOTO_IN_USE%','withdrawn evidence remains retained');
select throws_like($$select withdraw_external_item_request('f8400000-0000-4000-8000-000000000501','f8400000-0000-4000-8000-000000000302')$$,'%REQUEST_CONFLICT%','withdrawal UUID cannot be reused for another request');
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_like($$select withdraw_external_item_request(gen_random_uuid(),'f8400000-0000-4000-8000-000000000302')$$,'%REQUEST_NOT_FOUND%','foreign owners cannot withdraw');
select is(jsonb_array_length(my_external_item_requests_page(0,null,'history')->'requests'),0,'history is identity-scoped');
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000001","role":"authenticated"}';
select issue_external_item_offer(:'tenant','f8400000-0000-4000-8000-000000000401','f8400000-0000-4000-8000-000000000302',null,40000,100000,'f8400000-0000-4000-8000-000000000101');
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$select withdraw_external_item_request(gen_random_uuid(),'f8400000-0000-4000-8000-000000000302')$$,'%REQUEST_CHANGED%','an offer must be answered, not withdrawn');
select respond_external_item_offer(gen_random_uuid(),'f8400000-0000-4000-8000-000000000401',true,'f8400000-0000-4000-8000-000000000101');
select throws_like($$select withdraw_external_item_request(gen_random_uuid(),'f8400000-0000-4000-8000-000000000302')$$,'%REQUEST_CHANGED%','accepted commitments cannot be withdrawn');
reset role;
-- Synthetic clock movement, confined to this rolled-back fixture.
set constraints all immediate;
alter table external_item_offers disable trigger immutable_record;
update external_item_offers set created_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour';
alter table external_item_offers enable trigger immutable_record;
insert into external_item_offers(id,tenant_id,request_id,owner_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at)
 values('f8400000-0000-4000-8000-000000000402',:'tenant','f8400000-0000-4000-8000-000000000303','f8400000-0000-4000-8000-000000000002',30000,90000,'f8400000-0000-4000-8000-000000000101','f8400000-0000-4000-8000-000000000001',statement_timestamp()-interval '49 hours',statement_timestamp()-interval '1 hour');
set local role authenticated;
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(my_external_item_requests()->>'activeCount','28','only unanswered expired offer releases its slot');
select is(my_external_item_requests(0,'f8400000-0000-4000-8000-000000000302')#>>'{requests,0,lifecycleStatus}','accepted','accepted offer survives expiry');
select is(my_external_item_requests(0,'f8400000-0000-4000-8000-000000000303')#>>'{requests,0,lifecycleStatus}','expired','expired request is closed without a cleanup job');
select is(read_external_item_offer('f8400000-0000-4000-8000-000000000402')->>'canDecline','true','legacy offer response remains parseable; capacity is already free');
select is(jsonb_array_length(my_external_item_requests_page(0,null,'history')->'requests'),2,'history contains withdrawals and expired offers');
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$select issue_external_item_offer(%L,gen_random_uuid(),'f8400000-0000-4000-8000-000000000303','f8400000-0000-4000-8000-000000000402',40000,100000,'f8400000-0000-4000-8000-000000000101')$$,:'tenant'),'%REQUEST_CHANGED%','expired request cannot silently become active again');
select is(external_item_offer_queue_filtered(:'tenant',0,'withdrawn')->>'total','1','staff see withdrawal separately from a rejection');
select is((select count(*) from seller_ledger_entries where tenant_id=:'tenant'),0::bigint,'capacity changes create no financial entries');
reset role;
select ok(not has_function_privilege('anon','public.withdraw_external_item_request(uuid,uuid)','execute'),'anonymous withdrawal is forbidden');
select is(komisio_private.external_request_state('f8400000-0000-4000-8000-000000000304',now()+interval '300 days'),'waiting','unreviewed requests have no automatic age limit');
select ok(not has_function_privilege('authenticated','komisio_private.external_request_state(uuid,timestamptz)','execute'),'private projection cannot leak another owner state');
insert into auth.mfa_factors(id,created_at,updated_at,user_id,status,factor_type,friendly_name)
 values(gen_random_uuid(),now(),now(),'f8400000-0000-4000-8000-000000000002','verified','totp','Synthetic lifecycle MFA');
set local role authenticated;
set local request.jwt.claims='{"sub":"f8400000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select withdraw_external_item_request(gen_random_uuid(),'f8400000-0000-4000-8000-000000000304')$$,'42501',null,'MFA downgrade cannot withdraw');
select throws_ok($$select my_external_item_requests_page(0,null,'history')$$,'42501',null,'MFA downgrade cannot read history');
reset role;
select * from finish();
rollback;
