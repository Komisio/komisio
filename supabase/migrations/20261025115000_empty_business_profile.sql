-- An explicitly empty optional business object is as valid as omitting it.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.save_seller_profile(uuid,uuid,uuid,integer,jsonb)'::regprocedure);
 if position('(select jsonb_object_agg(key,case when jsonb_typeof(value)=''string'' then to_jsonb(trim(value#>>''{}'')) else value end) from jsonb_each(normalized->''business''))' in definition)=0 then raise exception 'UNEXPECTED_BUSINESS_NORMALIZER'; end if;
 definition:=replace(definition,
  '(select jsonb_object_agg(key,case when jsonb_typeof(value)=''string'' then to_jsonb(trim(value#>>''{}'')) else value end) from jsonb_each(normalized->''business''))',
  '(select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)=''string'' then to_jsonb(trim(value#>>''{}'')) else value end),''{}''::jsonb) from jsonb_each(normalized->''business''))');
 execute definition;
end $$;
