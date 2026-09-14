-- P3 economy brief: the weekly or monthly brief is a deterministic rendering
-- of the economy summary for one calendar period and the one before it.
-- No model writes it; the sentences are fixed templates over these numbers.
-- Nothing is stored: every read recomputes from the facts.
create function komisio_private.brief_period(p_kind text,p_end date) returns jsonb
language plpgsql immutable set search_path='' as $$
declare f date; t date; pf date; pt date;
begin
 if p_kind='week' then
  f:=date_trunc('week',p_end)::date; t:=f+6; pf:=f-7; pt:=f-1;
 elsif p_kind='month' then
  f:=date_trunc('month',p_end)::date; t:=(f+interval '1 month'-interval '1 day')::date; pf:=(f-interval '1 month')::date; pt:=f-1;
 else raise exception 'INVALID_INPUT';
 end if;
 return jsonb_build_object('from',f,'to',t,'previousFrom',pf,'previousTo',pt);
end $$;
revoke all on function komisio_private.brief_period(text,date) from public,anon,authenticated;

-- p_end names any local date inside the period; null means yesterday, so the
-- default brief covers the last period that has started.
create function public.economy_brief(p_tenant uuid,p_kind text,p_end date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare bounds jsonb; anchor date; cur jsonb; prev jsonb; accepted int; prev_accepted int; best jsonb;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_kind not in ('week','month') then raise exception 'INVALID_INPUT'; end if;
 anchor:=coalesce(p_end,(now() at time zone 'Europe/Stockholm')::date-1);
 if anchor<date '2000-01-01' or anchor>((now() at time zone 'Europe/Stockholm')+interval '2 years')::date then raise exception 'INVALID_INPUT'; end if;
 bounds:=komisio_private.brief_period(p_kind,anchor);
 cur:=public.economy_summary(p_tenant,(bounds->>'from')::date,(bounds->>'to')::date);
 prev:=public.economy_summary(p_tenant,(bounds->>'previousFrom')::date,(bounds->>'previousTo')::date);
 select count(*)::int into accepted from public.items i where i.tenant_id=p_tenant
  and i.accepted_at>=((bounds->>'from')||' 00:00')::timestamp at time zone 'Europe/Stockholm' and i.accepted_at<(((bounds->>'to')::date+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 select count(*)::int into prev_accepted from public.items i where i.tenant_id=p_tenant
  and i.accepted_at>=((bounds->>'previousFrom')||' 00:00')::timestamp at time zone 'Europe/Stockholm' and i.accepted_at<(((bounds->>'previousTo')::date+1)::text||' 00:00')::timestamp at time zone 'Europe/Stockholm';
 select d into best from jsonb_array_elements(cur->'days') d order by (d->>'grossOre')::bigint desc,d->>'date' limit 1;
 return jsonb_build_object('kind',p_kind,'anchor',anchor,'currency',cur->>'currency','timeZone','Europe/Stockholm',
  'period',jsonb_build_object('from',bounds->'from','to',bounds->'to'),'previousPeriod',jsonb_build_object('from',bounds->'previousFrom','to',bounds->'previousTo'),
  'current',cur->'totals','previous',prev->'totals','days',cur->'days','bestDay',best,
  'itemsAccepted',accepted,'previousItemsAccepted',prev_accepted,'liability',cur->'liability','openPayouts',cur->'openPayouts');
end $$;
revoke all on function public.economy_brief(uuid,text,date) from public,anon;
grant execute on function public.economy_brief(uuid,text,date) to authenticated;
