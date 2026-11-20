begin;
select no_plan();
create function pg_temp.uid(n bigint) returns uuid language sql immutable as $$
 select ('f4930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,email,email_confirmed_at) values
 (pg_temp.uid(1),'weight-evidence-staff@example.test',now()),
 (pg_temp.uid(2),'weight-evidence-seller@example.test',now()),
 (pg_temp.uid(3),'weight-evidence-other@example.test',now());
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select create_tenant('Synthetic copied weight','synthetic-copied-weight',gen_random_uuid()) as tenant \gset
select create_tenant('Synthetic other weight','synthetic-other-copied-weight',gen_random_uuid()) as other \gset
select publish_seller_agreement(:'tenant',pg_temp.uid(10),null,'Synthetic terms','Synthetic terms','sv',true);
reset role;
update public.platform_settings set central_app_tenant_id=:'tenant';
insert into komisio_private.seller_ai_runtime(singleton,key_hash)
 values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'))
 on conflict(singleton) do update set key_hash=excluded.key_hash;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
set local request.headers='{}';
select reserve_external_item_photo(pg_temp.uid(101),repeat('b',64),100);
select throws_like($$select verify_external_item_photo(pg_temp.uid(101),repeat('b',64),100)$$,'%FORBIDDEN%','a reservation hash cannot attest its own content');
select set_config('request.headers',jsonb_build_object('x-komisio-seller-ai',repeat('a',64))::text,true);
select throws_like($$select verify_external_item_photo(pg_temp.uid(101),repeat('b',64),100)$$,'%PHOTO_NOT_FOUND%','verification requires a stored object');
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(101)||'.jpg');
select throws_like($$select verify_external_item_photo(pg_temp.uid(101),repeat('c',64),100)$$,'%REQUEST_CONFLICT%','verification binds the exact uploaded hash');
select throws_like($$select verify_external_item_photo(pg_temp.uid(101),repeat('b',64),101)$$,'%REQUEST_CONFLICT%','verification binds the exact byte count');
select is(verify_external_item_photo(pg_temp.uid(101),repeat('b',64),100),pg_temp.uid(101),'server confirms the immutable upload');
select is(verify_external_item_photo(pg_temp.uid(101),repeat('b',64),100),pg_temp.uid(101),'verification retry is idempotent');
select throws_ok($$update external_item_photos set content_verified_at=null where id=pg_temp.uid(101)$$,'42501',null,'direct marker changes remain denied');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(3),'role','authenticated')::text,true);
select throws_like($$select verify_external_item_photo(pg_temp.uid(101),repeat('b',64),100)$$,'%PHOTO_NOT_FOUND%','server capability does not replace photo ownership');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select begin_external_photo_analysis(pg_temp.uid(201),:'tenant',array[pg_temp.uid(101)],'synthetic','sv','central-photo-v2-weight');
select complete_external_photo_analysis(pg_temp.uid(201),'{"description":"Dress","brand":null,"condition":"good","notes":"","estimatedWeightG":350}',100,10);

-- The mobile outbox keeps independent photo IDs but uploads the same bytes.
select reserve_external_item_photo(pg_temp.uid(102),repeat('b',64),100);
insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(102)||'.jpg');
select verify_external_item_photo(pg_temp.uid(102),repeat('b',64),100);
select discard_external_item_photo(pg_temp.uid(101));
-- Emulate the Storage API's own deletion context for synthetic fixture bytes.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='external-item-photos' and name=pg_temp.uid(2)||'/'||pg_temp.uid(101)||'.jpg';
select finish_external_item_photo_discard(pg_temp.uid(101));
select submit_external_item_request(pg_temp.uid(301),:'tenant','Dress','','good','',30000,'SEK',array[pg_temp.uid(102)],'SE','seller_amount');
select is((select weight_analysis_id from external_item_requests where id=pg_temp.uid(301)),pg_temp.uid(201),'copied photos retain weight even after AI draft-photo cleanup');
select is(submit_external_item_request(pg_temp.uid(301),:'tenant','Dress','','good','',30000,'SEK',array[pg_temp.uid(102)],'SE','seller_amount'),pg_temp.uid(301),'lost submission response replays the same request');
select throws_like($$select discard_external_item_photo(pg_temp.uid(102))$$,'%PHOTO_IN_USE%','submitted copy is retained independently of AI cleanup');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select issue_external_item_offer(:'tenant',pg_temp.uid(401),pg_temp.uid(301),null,50000,100000,pg_temp.uid(10));
select is(external_item_offer_queue_filtered(:'tenant',0,'all','Dress')#>>'{rows,0,estimated_weight_g}','350','staff read the linked estimate');
reset role;
select is(komisio_private.central_parcel_estimated_weight(array[pg_temp.uid(401)],'11'),450,'350 g item adds the approved 100 g packaging allowance');
select throws_like($$update external_item_photos set content_verified_at=null where id=pg_temp.uid(102)$$,'%PHOTO_IN_USE%','used photo evidence cannot be changed');

-- Synthetic immutable histories isolate matching dimensions, including cases
-- which the public AI endpoint correctly refuses to create for another owner.
create function pg_temp.seed_analysis(n integer,t uuid,u uuid,hashes text[],weight integer default 350,
 prompt text default 'central-photo-v2-weight',result_state text default 'ready',completed timestamptz default clock_timestamp()) returns void
language plpgsql as $$
declare ids uuid[]; evidence jsonb;
begin
 select array_agg(pg_temp.uid(n*10+i) order by i),
  jsonb_agg(jsonb_build_object('id',pg_temp.uid(n*10+i),'path',u||'/'||pg_temp.uid(n*10+i)||'.jpg','sha256',h) order by i)
 into ids,evidence from unnest(hashes) with ordinality x(h,i);
 insert into public.external_photo_ai_attempts(id,tenant_id,owner_id,photos,evidence,language,model,prompt_version)
 values(pg_temp.uid(n),t,u,ids,evidence,'sv','synthetic',prompt);
 if result_state<>'pending' then
  insert into public.external_photo_ai_results(id,tenant_id,output,input_tokens,output_tokens,created_at)
  values(pg_temp.uid(n),t,case when result_state='failed' then null else
   jsonb_build_object('description','Synthetic item','brand',null,'condition','good','notes','','estimatedWeightG',weight) end,100,10,completed);
 end if;
end $$;
create function pg_temp.copy_photo(n integer,h text,verified boolean default true) returns uuid language plpgsql as $$
begin
 perform public.reserve_external_item_photo(pg_temp.uid(n),h,100);
 insert into storage.objects(bucket_id,name) values('external-item-photos',pg_temp.uid(2)||'/'||pg_temp.uid(n)||'.jpg');
 if verified then perform public.verify_external_item_photo(pg_temp.uid(n),h,100); end if;
 return pg_temp.uid(n);
end $$;
create function pg_temp.submit(n integer,t uuid,photos uuid[]) returns uuid language sql as $$
 select public.submit_external_item_request(pg_temp.uid(n),t,'Synthetic item','','good','',30000,'SEK',photos,'SE','seller_amount');
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select pg_temp.copy_photo(110,repeat('b',64),false);
select pg_temp.submit(310,:'tenant',array[pg_temp.uid(110)]);
select is((select weight_analysis_id from external_item_requests where id=pg_temp.uid(310)),null::uuid,'an unverified copied reservation cannot borrow an AI weight');
select is(komisio_private.external_item_selection_weight(pg_temp.uid(310)),2000,'unverified content retains the conservative unknown-weight fallback');
select pg_temp.seed_analysis(211,:'tenant',pg_temp.uid(2),array[repeat('c',64),repeat('d',64)]);
select pg_temp.copy_photo(111,repeat('c',64));
select pg_temp.copy_photo(112,repeat('d',64));
select pg_temp.copy_photo(113,repeat('e',64));
select pg_temp.submit(311,:'tenant',array[pg_temp.uid(111),pg_temp.uid(112)]);
select is((select weight_analysis_id from external_item_requests where id=pg_temp.uid(311)),pg_temp.uid(211),'complete ordered copied image set matches');
select pg_temp.submit(312,:'tenant',array[pg_temp.uid(112),pg_temp.uid(111)]);
select pg_temp.submit(313,:'tenant',array[pg_temp.uid(111)]);
select pg_temp.submit(314,:'tenant',array[pg_temp.uid(111),pg_temp.uid(113)]);
select is((select count(*) from external_item_requests where id in (pg_temp.uid(312),pg_temp.uid(313),pg_temp.uid(314)) and weight_analysis_id is null),3::bigint,'different order, count or bytes cannot match');
select pg_temp.seed_analysis(212,:'tenant',pg_temp.uid(3),array[repeat('1',64)]);
select pg_temp.seed_analysis(213,:'other',pg_temp.uid(2),array[repeat('2',64)]);
select pg_temp.seed_analysis(214,:'tenant',pg_temp.uid(2),array[repeat('3',64)],350,'central-photo-v1');
select pg_temp.seed_analysis(215,:'tenant',pg_temp.uid(2),array[repeat('4',64)],350,'central-photo-v2-weight','pending');
select pg_temp.seed_analysis(216,:'tenant',pg_temp.uid(2),array[repeat('5',64)],350,'central-photo-v2-weight','failed');
select pg_temp.seed_analysis(217,:'tenant',pg_temp.uid(2),array[repeat('6',64)],350,'central-photo-v2-weight','ready',clock_timestamp()+interval '1 day');
select pg_temp.copy_photo(121,repeat('1',64)); select pg_temp.copy_photo(122,repeat('2',64));
select pg_temp.copy_photo(123,repeat('3',64)); select pg_temp.copy_photo(124,repeat('4',64));
select pg_temp.copy_photo(125,repeat('5',64)); select pg_temp.copy_photo(126,repeat('6',64));
select pg_temp.submit(321,:'tenant',array[pg_temp.uid(121)]); select pg_temp.submit(322,:'tenant',array[pg_temp.uid(122)]);
select pg_temp.submit(323,:'tenant',array[pg_temp.uid(123)]); select pg_temp.submit(324,:'tenant',array[pg_temp.uid(124)]);
select pg_temp.submit(325,:'tenant',array[pg_temp.uid(125)]); select pg_temp.submit(326,:'tenant',array[pg_temp.uid(126)]);
select is((select count(*) from external_item_requests where id in (pg_temp.uid(321),pg_temp.uid(322),pg_temp.uid(323),pg_temp.uid(324),pg_temp.uid(325),pg_temp.uid(326)) and weight_analysis_id is null),6::bigint,'owner, tenant, prompt, pending, failed and future-result boundaries all hold');
select pg_temp.seed_analysis(218,:'tenant',pg_temp.uid(2),array[repeat('7',64)],2501);
select pg_temp.copy_photo(127,repeat('7',64));
select pg_temp.submit(327,:'tenant',array[pg_temp.uid(127)]);
select is(komisio_private.external_item_selection_weight(pg_temp.uid(327)),2501,'known overweight copied item cannot fall back to the eligible unknown weight');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated')::text,true);
select issue_external_item_offer(:'tenant',pg_temp.uid(427),pg_temp.uid(327),null,50000,100000,pg_temp.uid(10));
reset role;
select throws_like($$select komisio_private.central_parcel_estimated_weight(array[pg_temp.uid(427)],'11')$$,'%PARCEL_WEIGHT_LIMIT%','overweight copied evidence prevents Home Small dispatch');
select pg_temp.seed_analysis(219,:'tenant',pg_temp.uid(2),array[repeat('8',64)],null);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(2),'role','authenticated')::text,true);
select pg_temp.copy_photo(128,repeat('8',64));
select pg_temp.submit(328,:'tenant',array[pg_temp.uid(128)]);
select is(komisio_private.external_item_selection_weight(pg_temp.uid(328)),2000,'an explicitly unknown AI weight keeps the fallback');
select pg_temp.seed_analysis(220,:'tenant',pg_temp.uid(2),array[repeat('b',64)],900);
select is((select weight_analysis_id from external_item_requests where id=pg_temp.uid(301)),pg_temp.uid(201),'later AI completion cannot rewrite a submitted weight link');
select throws_like($$update external_item_requests set weight_analysis_id=pg_temp.uid(220) where id=pg_temp.uid(301)$$,'%IMMUTABLE%','existing request provenance remains immutable');
select is((select count(*) from central_parcels where tenant_id=:'tenant'),0::bigint,'analysis linkage alone never books shipping');
select * from finish();
rollback;
