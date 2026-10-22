-- Covered revisions must be filtered before the queue limit; otherwise old
-- unchanged exports could indefinitely hide later days from the scheduled run.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.fortnox_automatic_exports(uuid)'::regprocedure);
 if position('order by e.created_at,e.id limit 100' in definition)=0 then raise exception 'UNEXPECTED_FORTNOX_QUEUE'; end if;
 execute replace(definition,'order by e.created_at,e.id limit 100',
  'and komisio_private.fortnox_delta_preview(e)->>''blockedReason'' not in (''FORTNOX_NO_CHANGES'',''FORTNOX_BASELINE_CHANGED'') order by e.created_at,e.id limit 100');
end $$;
