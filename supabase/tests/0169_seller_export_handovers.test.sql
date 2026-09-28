begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('f0000000-0000-4000-8000-000000000901','handover-export-owner@example.test',now()),
 ('f0000000-0000-4000-8000-000000000902','handover-export-other@example.test',now()),
 ('f0000000-0000-4000-8000-000000000903','handover-export-staff@example.test',now()),
 ('f0000000-0000-4000-8000-000000000904','handover-export-readonly@example.test',now()),
 ('f0000000-0000-4000-8000-000000000905','handover-export-admin@example.test',now());
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000901","role":"authenticated"}';
select set_config('test.t1',create_tenant('Handover export one','handover-export-one',gen_random_uuid())::text,true);
select set_config('test.s1',register_seller(current_setting('test.t1')::uuid,gen_random_uuid(),'Synthetic exported seller','handover-export-owner@example.test','')::text,true);
select set_config('test.other',register_seller(current_setting('test.t1')::uuid,gen_random_uuid(),'Synthetic other seller','handover-export-other@example.test','')::text,true);
select set_config('test.empty',register_seller(current_setting('test.t1')::uuid,gen_random_uuid(),'Synthetic empty seller','handover-export-empty@example.test','')::text,true);
select publish_store_policy(current_setting('test.t1')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.t1')::uuid)->'policy') || '{"custodySources":["staff_receipt","seller_dropoff"]}');
select set_config('test.agreement',publish_seller_agreement(current_setting('test.t1')::uuid,gen_random_uuid(),null,'Synthetic agreement','Only a test','en',true)::text,true);
select record_agreement_evidence(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,current_setting('test.agreement')::uuid,'Synthetic signed paper');
select set_config('test.open',create_my_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,'box',4,'Synthetic open note')::text,true);
select set_config('test.cancelled',create_my_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,'bag',2,'Synthetic cancelled note')::text,true);
select cancel_my_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.cancelled')::uuid);
select set_config('test.received',create_my_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.s1')::uuid,'box',7,'Synthetic received note')::text,true);
select receive_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.received')::uuid,'staff_receipt','Synthetic counter receipt');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000902","role":"authenticated"}';
select create_my_handover(current_setting('test.t1')::uuid,gen_random_uuid(),current_setting('test.other')::uuid,'bag',9,'EXCLUDED_OTHER_SELLER');
select set_config('test.t2',create_tenant('Handover export two','handover-export-two',gen_random_uuid())::text,true);
select set_config('test.s2',register_seller(current_setting('test.t2')::uuid,gen_random_uuid(),'Synthetic same email elsewhere','handover-export-owner@example.test','')::text,true);
select publish_store_policy(current_setting('test.t2')::uuid,gen_random_uuid(),null,(current_store_policy(current_setting('test.t2')::uuid)->'policy') || '{"custodySources":["staff_receipt","seller_dropoff"]}');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000901","role":"authenticated"}';
select create_my_handover(current_setting('test.t2')::uuid,gen_random_uuid(),current_setting('test.s2')::uuid,'box',11,'EXCLUDED_OTHER_STORE');
select set_config('test.export',seller_data_export(current_setting('test.t1')::uuid,current_setting('test.s1')::uuid)::text,true);
select is(jsonb_typeof(current_setting('test.export')::jsonb->'handovers'),'array','handovers have an array envelope');
select is(jsonb_array_length(current_setting('test.export')::jsonb->'handovers'),3,'all three own handovers included');
select is((select jsonb_agg(x->>'status' order by x->>'status') from jsonb_array_elements(current_setting('test.export')::jsonb->'handovers') x),'["cancelled","open","received"]'::jsonb,'all statuses included');
select is((select x->>'note' from jsonb_array_elements(current_setting('test.export')::jsonb->'handovers') x where x->>'id'=current_setting('test.open')),'Synthetic open note','seller note retained');
select is((select x->>'received_bag_id' from jsonb_array_elements(current_setting('test.export')::jsonb->'handovers') x where x->>'id'=current_setting('test.received')),current_setting('test.export')::jsonb->'bags'->0->>'id','received handover links to the exported bag');
select is(jsonb_array_length(current_setting('test.export')::jsonb->'handoverEvents'),5,'three created events and two transitions included');
select is((select count(*) from jsonb_array_elements(current_setting('test.export')::jsonb->'handoverEvents') x where x->>'kind'='created'),3::bigint,'created history retained');
select is((select count(*) from jsonb_array_elements(current_setting('test.export')::jsonb->'handoverEvents') x where x->>'kind'='cancelled'),1::bigint,'cancel history retained');
select is((select count(*) from jsonb_array_elements(current_setting('test.export')::jsonb->'handoverEvents') x where x->>'kind'='received'),1::bigint,'receipt history retained');
select is((select count(*) from jsonb_array_elements(current_setting('test.export')::jsonb->'handovers') x where x ? 'tenant_id'),0::bigint,'handover tenant ids stripped');
select is((select count(*) from jsonb_array_elements(current_setting('test.export')::jsonb->'handoverEvents') x where x ? 'tenant_id'),0::bigint,'event tenant ids stripped');
select is(position('EXCLUDED_OTHER_SELLER' in current_setting('test.export')),0,'another seller note excluded');
select is(position('EXCLUDED_OTHER_STORE' in current_setting('test.export')),0,'same-email seller in another store excluded');
select is(current_setting('test.export')::jsonb->'handovers',(select jsonb_agg(to_jsonb(h)-'tenant_id' order by h.created_at,h.id) from seller_handovers h where h.tenant_id=current_setting('test.t1')::uuid and h.seller_id=current_setting('test.s1')::uuid),'handover rows exact and deterministically ordered');
select is(current_setting('test.export')::jsonb->'handoverEvents',(select jsonb_agg(to_jsonb(e)-'tenant_id' order by e.occurred_at,e.id) from handover_events e join seller_handovers h on h.tenant_id=e.tenant_id and h.id=e.handover_id where h.tenant_id=current_setting('test.t1')::uuid and h.seller_id=current_setting('test.s1')::uuid),'event rows exact and deterministically ordered');
select is((select count(*) from access_events where tenant_id=current_setting('test.t1')::uuid and action='seller.exported' and target_id=current_setting('test.s1')::uuid),1::bigint,'one export access event');
select is(seller_data_export(current_setting('test.t1')::uuid,current_setting('test.empty')::uuid)->'handovers','[]'::jsonb,'empty handovers are an array');
select is(seller_data_export(current_setting('test.t1')::uuid,current_setting('test.empty')::uuid)->'handoverEvents','[]'::jsonb,'empty history is an array');
select throws_ok($$select seller_data_export(current_setting('test.t2')::uuid,current_setting('test.s2')::uuid)$$,'42501',null,'seller identity does not grant export in another store');
select throws_like($$select seller_data_export(current_setting('test.t1')::uuid,gen_random_uuid())$$,'%SELLER_NOT_FOUND%','unknown seller refused');
reset role;
insert into tenant_members(tenant_id,user_id,role) values
 (current_setting('test.t1')::uuid,'f0000000-0000-4000-8000-000000000903','staff'),
 (current_setting('test.t1')::uuid,'f0000000-0000-4000-8000-000000000904','readonly'),
 (current_setting('test.t1')::uuid,'f0000000-0000-4000-8000-000000000905','admin');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000903","role":"authenticated"}';
select throws_ok($$select seller_data_export(current_setting('test.t1')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'staff refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000904","role":"authenticated"}';
select throws_ok($$select seller_data_export(current_setting('test.t1')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'readonly refused');
set local "request.jwt.claims"='{"sub":"f0000000-0000-4000-8000-000000000905","role":"authenticated"}';
select is(jsonb_array_length(seller_data_export(current_setting('test.t1')::uuid,current_setting('test.s1')::uuid)->'handovers'),3,'admin retains access to complete export');
set local role anon;
select throws_ok($$select seller_data_export(current_setting('test.t1')::uuid,current_setting('test.s1')::uuid)$$,'42501',null,'anonymous execution refused');
select * from finish();
rollback;
