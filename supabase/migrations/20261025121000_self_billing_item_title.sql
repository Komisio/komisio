-- Item descriptions belong to the versioned reception, not the core item row.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.statement_self_billing()'::regprocedure);
 if position('i.description' in definition)=0 then raise exception 'UNEXPECTED_SELF_BILLING'; end if;
 execute replace(definition,'i.description','komisio_private.item_title(new.tenant_id,i.id)->>''title'' as description');
end $$;
