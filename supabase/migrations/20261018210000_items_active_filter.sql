-- Owner-approved #510 read filter; lifecycle facts and authorization are unchanged.
do $migration$
declare
 source text := pg_get_functiondef('public.items_search_page(uuid,jsonb,text,text,integer,integer)'::regprocedure);
 changed text;
begin
 changed := replace(source,
   $old$f->>'stage' not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold')$old$,
   $new$f->>'stage' not in ('active','on_sale','markdown_due','period_ending','period_ended','ended','sold')$new$);
 if changed = source then raise exception 'Missing stage validation'; end if;
 source := changed;
 changed := replace(source,
   $old$(not f ? 'stage' or stage=f->>'stage')$old$,
   $new$(not f ? 'stage' or stage=f->>'stage' or (f->>'stage'='active' and stage in ('on_sale','markdown_due','period_ending')))$new$);
 if changed = source then raise exception 'Missing stage predicate'; end if;
 execute changed;
end
$migration$;
