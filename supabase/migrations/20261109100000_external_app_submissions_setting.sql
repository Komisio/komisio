-- Save a default-off preference for future proposals from external app users.
-- No public discovery, submission access or commercial terms change here.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_external_app(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_external_app(jsonb) from public,anon,authenticated;
create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(komisio_private.valid_store_policy_before_external_app(value-'externalAppSubmissionsEnabled')
  and (not(value ? 'externalAppSubmissionsEnabled') or jsonb_typeof(value->'externalAppSubmissionsEnabled')='boolean'),false)
$$;
revoke all on function komisio_private.valid_store_policy(jsonb) from public,anon,authenticated;
