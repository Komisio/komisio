begin;
select plan(4);
select ok(komisio_private.catalogue_json_reference('[{"kind":"observation","reference":"komisio:manual-item-type:v1","observation":"jacket"}]','type','jacket','{}'), 'manual type source counts as catalogue use');
select ok(not komisio_private.catalogue_json_reference('[{"kind":"observation","reference":"komisio:manual-item-type:v1","observation":"jacket"}]','type','lamp','{}'), 'another type is not referenced');
select ok(not komisio_private.catalogue_json_reference('[{"kind":"observation","reference":"Staff","observation":"jacket"}]','type','jacket','{}'), 'free text is not interpreted as a type');
select ok(komisio_private.catalogue_json_reference('{"suggestions":{"itemType":"jacket"}}','type','jacket','{}'), 'existing structured references remain protected');
select * from finish();
rollback;
