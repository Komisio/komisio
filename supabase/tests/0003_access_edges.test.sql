begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users(id,email,email_confirmed_at) values
 ('30000000-0000-0000-0000-000000000001','owner@edges.test',now()),
 ('30000000-0000-0000-0000-000000000002','recipient@edges.test',now()),
 ('30000000-0000-0000-0000-000000000003','unverified@edges.test',null);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select set_config('test.tenant',create_tenant('Edge cases','access-edges','40000000-0000-0000-0000-000000000001')::text,true);
select is((select count(*) from list_members(current_setting('test.tenant')::uuid)),1::bigint,'directory returns typed member rows');
select is((select email from list_members(current_setting('test.tenant')::uuid)),'owner@edges.test','owner sees directory email');
select create_invitation(current_setting('test.tenant')::uuid,'recipient@edges.test','staff',repeat('d',64));
select revoke_invitation(current_setting('test.tenant')::uuid,(select id from tenant_invitations where email='recipient@edges.test'));
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_like($$select accept_invitation(repeat('d',64))$$,'%INVITATION_INVALID%','revoked invitation fails');
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}';
select create_invitation(current_setting('test.tenant')::uuid,'recipient@edges.test','readonly',repeat('e',64));
reset role;
update tenant_invitations set expires_at=now()-interval '1 second' where token_hash=repeat('e',64);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_like($$select accept_invitation(repeat('e',64))$$,'%INVITATION_INVALID%','expired invitation fails');
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}';
select create_invitation(current_setting('test.tenant')::uuid,'recipient@edges.test','readonly',repeat('f',64));
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}';
select accept_invitation(repeat('f',64));
select is((select email from list_members(current_setting('test.tenant')::uuid) where role='owner'),null::text,'readonly cannot read another member email');
select throws_like($$select rename_tenant(current_setting('test.tenant')::uuid,'Not allowed')$$,'%FORBIDDEN%','readonly cannot rename a store');
select is((select count(*) from access_events),0::bigint,'readonly cannot read the audit log');
select throws_ok($$select token_hash from tenant_invitations$$,'42501',null,'invitation hashes are not API-readable');
select throws_ok($$delete from access_events$$,'42501',null,'audit records cannot be deleted through the API');

set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_like($$select create_tenant('Unverified','unverified-edges',gen_random_uuid())$$,'%AUTH_REQUIRED%','unverified email cannot create a store');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','totp','verified',now(),now());
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select is((select count(*) from tenants),0::bigint,'partial MFA session has no tenant reads');
select throws_like($$select save_profile('Bypass','en')$$,'%AUTH_REQUIRED%','partial MFA session cannot write via RPC');
set local "request.jwt.claims" = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select is((select count(*) from tenants),1::bigint,'verified MFA session can read its tenant');
select lives_ok($$select save_profile('Verified','en')$$,'verified MFA session can update its profile');
select change_member(current_setting('test.tenant')::uuid,'30000000-0000-0000-0000-000000000002','owner');
select change_member(current_setting('test.tenant')::uuid,'30000000-0000-0000-0000-000000000001',null);
select throws_like($$select create_tenant('Edge cases','access-edges','40000000-0000-0000-0000-000000000001')$$,'%FORBIDDEN%','creation retry cannot reactivate a store after removal');
reset role;
select * from finish();
rollback;
