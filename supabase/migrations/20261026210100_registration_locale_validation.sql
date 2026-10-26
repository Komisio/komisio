-- The source migration may have CRLF line endings; normalize before inserting
-- the explicit boundary check so older clients receive the same error contract.
do $$
declare definition text;
begin
 definition:=replace(pg_get_functiondef('public.submit_seller_registration_in_language(text,uuid,text,text,uuid,uuid,boolean,uuid,text)'::regprocedure),E'\r\n',E'\n');
 if position('if p_locale is not null' in definition)=0 then
  if position(E'begin\n' in definition)=0 then raise exception 'UNEXPECTED_REGISTRATION_LOCALE_DEFINITION'; end if;
  execute replace(definition,E'begin\n',E'begin\n if p_locale is not null and p_locale not in (''sv'',''en'',''no'',''dk'',''fi'',''de'',''es'',''it'') then raise exception ''INVALID_INPUT''; end if;\n');
 end if;
end $$;
