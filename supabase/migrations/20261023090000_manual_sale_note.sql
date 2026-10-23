-- #570: staff-only immutable sale evidence; no ledger or pricing changes.
alter table public.sales add column staff_note text not null default '' check(length(staff_note)<=500);
do $$ declare definition text; signature regprocedure; begin
 definition:=pg_get_functiondef('komisio_private.record_sale_core(uuid,uuid,text,text,timestamptz,text,jsonb,jsonb)'::regprocedure);
 if position('total,p_reference,uid)' in definition)=0 or position('existing_lines is distinct from p_lines' in definition)=0 then raise exception 'UNEXPECTED_SALE_CORE'; end if;
 definition:=replace(definition,'if p_currency<>',
  'if p_reference ? ''manualNote'' and (p_provider<>''manual'' or jsonb_typeof(p_reference->''manualNote'')<>''string'' or length(p_reference->>''manualNote'')>500) then raise exception ''INVALID_INPUT''; end if; if p_currency<>');
 definition:=replace(definition,'existing_lines is distinct from p_lines',
  'existing_lines is distinct from p_lines or prior.staff_note is distinct from trim(coalesce(p_reference->>''manualNote'',''''))');
 definition:=replace(definition,'provider_reference,recorded_by)','provider_reference,recorded_by,staff_note)');
 definition:=replace(definition,'total,p_reference,uid)','total,p_reference,uid,trim(coalesce(p_reference->>''manualNote'','''')))');
 execute definition;
 foreach signature in array array['public.sales_page(uuid,text,text,text,integer)'::regprocedure,'public.sale_detail(uuid,uuid)'::regprocedure] loop
  definition:=pg_get_functiondef(signature);
  if position('s.status,s.recorded_at' in definition)=0 then raise exception 'UNEXPECTED_SALE_READ'; end if;
  execute replace(definition,'s.status,s.recorded_at','s.status,s.recorded_at,s.staff_note');
 end loop;
end $$;
