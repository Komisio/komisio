-- Store-owned mail preference, independent of a public profile or staff UI.
-- Existing immutable policy versions and message history are not rewritten.
do $$ begin
 execute replace(pg_get_functiondef('komisio_private.valid_store_policy(jsonb)'::regprocedure),
  'FUNCTION komisio_private.valid_store_policy(', 'FUNCTION komisio_private.valid_store_policy_before_mail_language(');
end $$;
revoke all on function komisio_private.valid_store_policy_before_mail_language(jsonb) from public,anon,authenticated;

create or replace function komisio_private.valid_store_policy(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if not komisio_private.valid_store_policy_before_mail_language(value-'communicationLanguage') then return false; end if;
 if not(value ? 'communicationLanguage') then return true; end if;
 return jsonb_typeof(value->'communicationLanguage')='string'
  and value->>'communicationLanguage' in ('sv','en','no','dk','fi','de','es','it');
end $$;
revoke all on function komisio_private.valid_store_policy(jsonb) from public,anon,authenticated;
