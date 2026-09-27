-- Bounded lifecycle work list: one page of twenty rows with the matched total
-- and a store-wide due count that ignores the stage and text filters, because
-- the batch markdown command is store-wide. Rows carry exactly the facts the
-- legacy lifecycle_queue derives per item; nothing is re-derived here. The
-- legacy lifecycle_queue_display read keeps its signature and behaviour.
create function public.lifecycle_queue_page(p_tenant uuid,p_query text default '',p_stage text default null,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=lower(btrim(coalesce(p_query,''))); skip integer:=p_offset; rows jsonb; total integer; due integer;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if skip is null or skip<0 or char_length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 if p_stage is not null and p_stage not in ('on_sale','markdown_due','period_ending','period_ended','ended','sold') then raise exception 'INVALID_INPUT'; end if;
 with candidates as materialized (
  select c from public.lifecycle_queue(p_tenant,null) c
 ), scan as materialized (
  select c from candidates where p_stage is null or (c).stage=p_stage
 ), matched as materialized (
  -- Literal, case-insensitive match on the full id, the I- label prefix or the
  -- title. The title is looked up only when the query is not empty and the
  -- cheap id match did not already accept the row.
  select s.c,t.title as maybe_title from scan s
  cross join lateral (
   select case when q='' or strpos((s.c).item_id::text,q)>0 or strpos('i-'||left((s.c).item_id::text,8),q)>0 then null
    else komisio_private.item_title(p_tenant,(s.c).item_id)->>'title' end as title
  ) t
  where q='' or strpos((s.c).item_id::text,q)>0 or strpos('i-'||left((s.c).item_id::text,8),q)>0 or strpos(lower(coalesce(t.title,'')),q)>0
 ), page as materialized (
  select * from matched order by (c).accepted_at,(c).item_id limit 20 offset skip
 )
 select (select count(*)::int from candidates where (c).stage='markdown_due'),
  (select count(*)::int from matched),
  coalesce((select jsonb_agg(to_jsonb(p.c)||jsonb_build_object('title',coalesce(p.maybe_title,komisio_private.item_title(p_tenant,(p.c).item_id)->>'title'))
   order by (p.c).accepted_at,(p.c).item_id) from page p),'[]'::jsonb)
 into due,total,rows;
 return jsonb_build_object('rows',rows,'total',total,'dueCount',due,'offset',skip,'limit',20);
end $$;
revoke all on function public.lifecycle_queue_page(uuid,text,text,integer) from public,anon;
grant execute on function public.lifecycle_queue_page(uuid,text,text,integer) to authenticated;
