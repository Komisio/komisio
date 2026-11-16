begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values
 ('f6870000-0000-4000-8000-000000000001','deletion@example.test',now(),null,null),
 ('f6870000-0000-4000-8000-000000000002',null,null,'46700006872',now()),
 ('f6870000-0000-4000-8000-000000000003','host-deletion@example.test',now(),null,null),
 ('f6870000-0000-4000-8000-000000000004','other-deletion@example.test',now(),null,null);
insert into auth.sessions(id,user_id,aal) values
 ('f6870000-0000-4000-8000-000000000011','f6870000-0000-4000-8000-000000000001','aal1'),
 ('f6870000-0000-4000-8000-000000000012','f6870000-0000-4000-8000-000000000002','aal1'),
 ('f6870000-0000-4000-8000-000000000013','f6870000-0000-4000-8000-000000000003','aal1'),
 ('f6870000-0000-4000-8000-000000000014','f6870000-0000-4000-8000-000000000004','aal1');
insert into public.platform_hosts(user_id,kind) values ('f6870000-0000-4000-8000-000000000003','person');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('synthetic-apple-deletion','f6870000-0000-4000-8000-000000000002','{"sub":"synthetic-apple-deletion"}','apple');
set local role authenticated;
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000011","aal":"aal1"}';
select is(my_account_deletion(),null::jsonb,'no request until explicit confirmation');
select throws_like($$select request_account_deletion('f6870000-0000-4000-8000-000000000021','sv',false)$$,'%INVALID_INPUT%','confirmation required');
select is(request_account_deletion('f6870000-0000-4000-8000-000000000021','sv',true)->>'status','requested','email account submits');
select is(request_account_deletion('f6870000-0000-4000-8000-000000000022','en',true)->>'id','f6870000-0000-4000-8000-000000000021','lost response and second devices find the same request');
select is((select count(*) from account_deletion_requests),1::bigint,'self-only request read');
select throws_ok($$delete from account_deletion_requests$$,'42501',null,'client cannot delete requests');
select throws_ok($$insert into account_deletion_events(id,request_id,kind,created_by) values(gen_random_uuid(),'f6870000-0000-4000-8000-000000000021','completed',auth.uid())$$,'42501',null,'client cannot forge completion');
select throws_like($$select host_account_deletions(0)$$,'%FORBIDDEN%','ordinary account cannot inspect the queue');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000012","aal":"aal1"}';
select is((select count(*) from account_deletion_requests),0::bigint,'other request is private');
select throws_like($$select request_account_deletion('f6870000-0000-4000-8000-000000000021','sv',true)$$,'%REQUEST_CONFLICT%','cannot reuse another account request ID');
select is(request_account_deletion('f6870000-0000-4000-8000-000000000023','sv',true)->>'status','requested','phone-only account needs no store or email');
select is(public.verified_session(),false,'ordinary email-only boundary is unchanged');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000013","aal":"aal1"}';
select is((select count(*) from jsonb_array_elements(host_account_deletions(0)->'rows') v where v->>'userId' in ('f6870000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-000000000002')),2::bigint,'host sees cases');
select is(handle_account_deletion('f6870000-0000-4000-8000-000000000031','f6870000-0000-4000-8000-000000000021',null,'processing','{}')->>'status','processing','host starts handling');
select is(handle_account_deletion('f6870000-0000-4000-8000-000000000031','f6870000-0000-4000-8000-000000000021',null,'processing','{}')->>'status','processing','same event replays');
select throws_like($$select handle_account_deletion(gen_random_uuid(),'f6870000-0000-4000-8000-000000000021',null,'completed','{}')$$,'%REQUEST_CHANGED%','stale state cannot complete');
select throws_like($$select handle_account_deletion(gen_random_uuid(),'f6870000-0000-4000-8000-000000000021','f6870000-0000-4000-8000-000000000031','completed','{"personalDataReviewed":true,"externalCopiesReviewed":true,"confirmationSent":true,"appleHandling":"not_applicable","retentionReason":"No retained evidence.","confirmationReference":"synthetic-confirmation"}')$$,'%DELETION_INCOMPLETE%','active Auth account cannot be marked erased');
reset role;
select is((select count(*) from auth.users where id='f6870000-0000-4000-8000-000000000001' and deleted_at is null),1::bigint,'request never deletes Auth');
select is((select respond_by=created_at+interval '1 month' from account_deletion_requests where id='f6870000-0000-4000-8000-000000000021'),true,'one-month handling deadline is durable');
update auth.users set deleted_at=now() where id='f6870000-0000-4000-8000-000000000001';
delete from auth.sessions where user_id='f6870000-0000-4000-8000-000000000001';
delete from user_profiles where user_id='f6870000-0000-4000-8000-000000000001';
set local role authenticated;
select is(handle_account_deletion('f6870000-0000-4000-8000-000000000032','f6870000-0000-4000-8000-000000000021','f6870000-0000-4000-8000-000000000031','completed','{"personalDataReviewed":true,"externalCopiesReviewed":true,"confirmationSent":true,"appleHandling":"not_applicable","retentionReason":"No retained evidence.","confirmationReference":"synthetic-confirmation"}')->>'status','completed','completed only after Auth and profile removal plus operator evidence');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000011","aal":"aal1"}';
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','deleted account and stale JWT cannot read');
reset role;
-- Native/social account deletion cannot be declared complete by ignoring Apple.
delete from auth.identities where user_id='f6870000-0000-4000-8000-000000000002';
delete from auth.sessions where user_id='f6870000-0000-4000-8000-000000000002';
delete from user_profiles where user_id='f6870000-0000-4000-8000-000000000002';
update auth.users set deleted_at=now() where id='f6870000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000013","aal":"aal1"}';
select handle_account_deletion('f6870000-0000-4000-8000-000000000033','f6870000-0000-4000-8000-000000000023',null,'processing','{}');
select throws_like($$select handle_account_deletion(gen_random_uuid(),'f6870000-0000-4000-8000-000000000023','f6870000-0000-4000-8000-000000000033','completed','{"personalDataReviewed":true,"externalCopiesReviewed":true,"confirmationSent":true,"appleHandling":"not_applicable","retentionReason":"No retained evidence.","confirmationReference":"synthetic-confirmation"}')$$,'%INVALID_INPUT%','Apple identity cannot be ignored after Auth deletion');
select is(handle_account_deletion(gen_random_uuid(),'f6870000-0000-4000-8000-000000000023','f6870000-0000-4000-8000-000000000033','completed','{"personalDataReviewed":true,"externalCopiesReviewed":true,"confirmationSent":true,"appleHandling":"manual_instructions","retentionReason":"No retained evidence.","confirmationReference":"synthetic-confirmation"}')->>'status','completed','documented Apple fallback does not make the user perform a mandatory extra step');
select create_tenant('Deletion test store','deletion-test-store',gen_random_uuid()) as tenant \gset
select register_seller(:'tenant','f6870000-0000-4000-8000-000000000041','Synthetic seller','other-deletion@example.test','');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000004","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000014","aal":"aal1"}';
select request_account_deletion('f6870000-0000-4000-8000-000000000024','sv',true);
select is((select seller_ids from account_deletion_requests),array['f6870000-0000-4000-8000-000000000041']::uuid[],'verified email seller link captured durably');
reset role;
update auth.users set email='changed-deletion@example.test' where id='f6870000-0000-4000-8000-000000000004';
select is(komisio_private.deletion_checks('f6870000-0000-4000-8000-000000000024')->>'sellerContactsClosed','false','email change does not hide the original seller contact');
select is((select name from sellers where id='f6870000-0000-4000-8000-000000000041'),'Synthetic seller','request never anonymizes a linked store contact');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'f6870000-0000-4000-8000-000000000004','totp','verified',now(),now());
set local role authenticated;
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','enrolled MFA blocks aal1');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000004","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000014","aal":"aal2"}';
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','JWT assurance alone cannot replace an aal2 session');
reset role;
update auth.sessions set aal='aal2' where id='f6870000-0000-4000-8000-000000000014';
set local role authenticated;
select is(my_account_deletion()->>'status','requested','completed MFA permits own status');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000004","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000013","aal":"aal2"}';
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','another users session is rejected');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}';
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','missing session is rejected');
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000004","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000014","aal":"aal2"}';
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id='f6870000-0000-4000-8000-000000000014';
set local role authenticated;
select throws_like($$select my_account_deletion()$$,'%AUTH_REQUIRED%','expired session is rejected');
select is((select count(*) from account_deletion_requests),0::bigint,'expired session cannot bypass the RPC through RLS');
reset role;
select throws_like($$update account_deletion_events set kind='completed'$$,'%IMMUTABLE%','handling history is immutable even for maintenance');
set local role authenticated;
set local request.jwt.claims='{"sub":"f6870000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f6870000-0000-4000-8000-000000000013","aal":"aal1"}';
select start_host_support('f6870000-0000-4000-8000-000000000051',:'tenant','Synthetic privacy review');
select throws_like($$select host_account_deletions(0)$$,'%AUTH_REQUIRED%','host cannot handle privacy while in read-only support mode');
select is((select count(*) from account_deletion_events),0::bigint,'support cannot read handling evidence directly');
reset role;
select * from finish();
rollback;
