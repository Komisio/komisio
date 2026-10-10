-- Reuse the existing recorded fee totals; do not change fee or export rules.
do $$ declare definition text; needle text:='if previous_id is not null or (totals->>''salesCount'')::int>0'; begin
 definition:=pg_get_functiondef('public.run_automatic_day_closes(uuid,uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_AUTOMATIC_CLOSE_DEFINITION'; end if;
 definition:=replace(definition,needle,'if (totals->''perMode'') ?| array[''consignment_fee'',''consignment_fee_reversal''] or previous_id is not null or (totals->>''salesCount'')::int>0');
 execute definition;
end $$;
revoke all on function public.run_automatic_day_closes(uuid,uuid) from public,anon;
grant execute on function public.run_automatic_day_closes(uuid,uuid) to authenticated;
