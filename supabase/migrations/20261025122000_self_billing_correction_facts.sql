-- Reuse exact integer VAT extraction and pin corrections to their source period.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('komisio_private.sale_line_facts(uuid,uuid,bigint,jsonb)'::regprocedure);
 if position('round(credit::numeric*vat_rate_bp/(10000+vat_rate_bp))::bigint' in definition)=0 then raise exception 'UNEXPECTED_SUPPLIER_VAT'; end if;
 execute replace(definition,'round(credit::numeric*vat_rate_bp/(10000+vat_rate_bp))::bigint','komisio_private.vat_from_gross(credit,vat_rate_bp)');
 definition:=pg_get_functiondef('komisio_private.statement_self_billing()'::regprocedure);
 if position('if original is null then' in definition)=0 then raise exception 'UNEXPECTED_SELF_BILLING'; end if;
 execute replace(definition,'if original is null then',$patch$
  if not exists(select 1 from public.settlement_statements where tenant_id=new.tenant_id and id=new.corrects_id and period_from=new.period_from and period_to=new.period_to) then raise exception 'INVALID_INPUT'; end if;
  if original is null then$patch$);
end $$;
