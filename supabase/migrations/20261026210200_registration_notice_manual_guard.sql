-- The generic manual-mail path must not recover permission for a claimed reply.
do $$
declare definition text; needle text:=E' if found then\n';
begin
 definition:=replace(pg_get_functiondef('public.queue_seller_communication(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid)'::regprocedure),E'\r\n',E'\n');
 if position(needle in definition)=0 then raise exception 'UNEXPECTED_COMMUNICATION_QUEUE'; end if;
 execute replace(definition,needle,needle||E'  if prior.registration_review_id is not null then raise exception ''INVALID_INPUT''; end if;\n');
end $$;
