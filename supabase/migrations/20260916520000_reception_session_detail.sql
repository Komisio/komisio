-- One reception as an engine function (2026-09-16, Opus). Reading a reception
-- meant two table reads, so the three tools built on it were unavailable to a
-- store's own assistant: the connector reaches SQL functions and nothing else.
-- This returns the same two rows in one call, with the store-role check the
-- row-level policies applied, and the field names the application parses.
-- A session that exists with no sources yet is not an error: it returns
-- revision 0 and no sources, which is how a reception starts.
create function public.reception_session_detail(p_tenant uuid,p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.reception_sessions; cur record;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.reception_sessions where tenant_id=p_tenant and id=p_session;
 if not found then return null; end if;
 select r.revision,r.sources into cur from public.reception_source_revisions r
  where r.tenant_id=p_tenant and r.session_id=p_session order by r.revision desc limit 1;
 return jsonb_build_object('session_id',s.id,'seller_id',s.seller_id,
  'revision',coalesce(cur.revision,0),'sources',cur.sources);
end $$;
revoke all on function public.reception_session_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reception_session_detail(uuid,uuid) to authenticated;
-- Each of the three tools built on this read asks for its own scope, so each
-- scope must reach the read: the plain read, the preview that proposes nothing
-- and the staged review.
insert into public.connector_functions(function_name,scope,kind) values
 ('reception_session_detail','reception:read',''),
 ('reception_session_detail','reception:preview',''),
 ('reception_session_detail','reception:propose','')
 on conflict do nothing;
-- The staged review itself was never registered: reception:propose reached no
-- proposal kind at all, so the tool would have refused at its last step even
-- with the read in place. The kind is the one the reception review stages.
insert into public.connector_functions(function_name,scope,kind) values
 ('propose_operation','reception:propose','publishReceptionReview')
 on conflict do nothing;
