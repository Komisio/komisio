-- Rebind the existing check to the extended validator after the wrapper rename.
-- PostgreSQL constraints retain function OIDs rather than following their names.
alter table public.store_policy_versions drop constraint store_policy_versions_policy_check;
alter table public.store_policy_versions add constraint store_policy_versions_policy_check
 check(komisio_private.valid_store_policy(policy));
