-- Store-facing projections deliberately omit bank details, national IDs and internal notes.
create view komisio_private.store_api_records with (security_invoker=true) as
 select tenant_id,id,'sellers'::text as resource,jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,'revision',profile_revision) as record
 from public.sellers where privacy_closed_at is null
 union all
 select s.tenant_id,s.id,'sales',jsonb_build_object('id',s.id,'externalId',s.external_id,'provider',s.provider,'occurredAt',s.occurred_at,
  'currency',s.currency,'totalMinor',s.total_ore,'status',s.status,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'itemId',l.item_id,'priceMinor',l.price_ore)
  order by l.line_no) from public.sale_lines l where l.tenant_id=s.tenant_id and l.sale_id=s.id),'[]'::jsonb)) from public.sales s
 union all
 select r.tenant_id,r.id,'returns',jsonb_build_object('id',r.id,'saleLineId',r.sale_line_id,'itemId',r.item_id,'refundMinor',r.refund_ore,
  'currency',s.currency,'occurredAt',r.occurred_at) from public.sale_returns r join public.sale_lines l on (l.tenant_id,l.id)=(r.tenant_id,r.sale_line_id)
  join public.sales s on (s.tenant_id,s.id)=(l.tenant_id,l.sale_id)
 union all
 select tenant_id,id,'payouts',jsonb_build_object('id',id,'sellerId',seller_id,'amountMinor',amount_ore,'currency',currency,
  'status',status,'requestedAt',requested_at) from public.payouts;
revoke all on komisio_private.store_api_records from public,anon,authenticated;

create function public.store_api_records(p_secret text,p_resource text,p_limit integer,p_after uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; records jsonb;
begin
 if p_resource is null or p_resource not in ('sellers','sales','returns','payouts') then raise exception 'INVALID_INPUT'; end if;
 k:=komisio_private.claim_store_api_key(p_secret,p_resource||':read');
 if p_limit is null or p_limit not between 1 and 100 or (p_id is not null and p_after is not null) then raise exception 'INVALID_INPUT'; end if;
 select coalesce(jsonb_agg(record order by id),'[]'::jsonb) into records from
 (select id,record from komisio_private.store_api_records where resource=p_resource and tenant_id=k.tenant_id
  and (p_after is null or id>p_after) and (p_id is null or id=p_id) order by id limit p_limit+1) page;
 if jsonb_array_length(records)>p_limit then
  return jsonb_build_object('records',records-p_limit,'nextCursor',records->(p_limit-1)->>'id'); end if;
 return jsonb_build_object('records',records,'nextCursor',null);
end $$;

-- The review queue carries only the command name. Personal details stay in the
-- private envelope, visible to the owner/admin reviewing that specific operation.
create table komisio_private.store_api_requests(
 id uuid primary key references public.pending_operations(id),
 key_id uuid not null references komisio_private.store_inventory_keys(id),
 replay_id uuid not null,
 action text not null,
 subject uuid,
 body jsonb not null,
 body_digest bytea not null,
 unique(key_id,replay_id)
);
alter table komisio_private.store_api_requests enable row level security;
revoke all on komisio_private.store_api_requests from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate on komisio_private.store_api_requests
 for each statement execute function komisio_private.guard_support_write();

-- Once reviewed, the engine owns the seller facts. Keep only the digest needed
-- to distinguish exact retries from altered requests. Revocation also discards
-- unreviewed contact data; closed seller records cannot receive pending edits.
create function komisio_private.clear_store_api_contact_body() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='operation_decisions' then
  update komisio_private.store_api_requests set body='{}' where id=new.operation_id and action in ('createSeller','editSeller');
 elsif tg_table_name='store_inventory_keys' then
  update komisio_private.store_api_requests set body='{}' where key_id=new.id and action in ('createSeller','editSeller') and body<>'{}';
 else
  update komisio_private.store_api_requests r set body='{}' from public.pending_operations o where o.id=r.id and o.tenant_id=new.tenant_id
   and r.action='editSeller' and r.subject=new.id and r.body<>'{}';
 end if;
 return null;
end $$;
revoke all on function komisio_private.clear_store_api_contact_body() from public,anon,authenticated;
create trigger store_api_decision_cleanup after insert on public.operation_decisions for each row execute function komisio_private.clear_store_api_contact_body();
create trigger store_api_key_cleanup after update of revoked_at on komisio_private.store_inventory_keys for each row when (new.revoked_at is not null and old.revoked_at is null) execute function komisio_private.clear_store_api_contact_body();
create trigger store_api_seller_cleanup after update of privacy_closed_at on public.sellers for each row when (new.privacy_closed_at is not null and old.privacy_closed_at is null) execute function komisio_private.clear_store_api_contact_body();

create function komisio_private.store_api_write_scope(action text) returns text
language sql immutable set search_path='' as $$
 select case when action in ('createSeller','editSeller') then 'sellers:write'
 when action in ('createItem','editItem','endItem') then 'items:write'
 when action='recordSale' then 'sales:write' when action='recordReturn' then 'returns:write' end;
$$;
revoke all on function komisio_private.store_api_write_scope(text) from public,anon,authenticated;

-- Extend the existing four-eyes review path. Its proposer endpoints do not
-- accept this kind: only an authenticated, scoped store key may submit it.
do $$ declare predicate text; begin
 select pg_get_expr(conbin,conrelid) into strict predicate from pg_constraint
  where conrelid='public.pending_operations'::regclass and conname='pending_operations_kind_check';
 alter table public.pending_operations drop constraint pending_operations_kind_check;
 execute format('alter table public.pending_operations add constraint pending_operations_kind_check check ((%s) or kind=%L)',predicate,'storeApiChange');
end $$;

create function public.submit_store_api_request(p_secret text,p_replay uuid,p_action text,p_subject uuid,p_body jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; prior komisio_private.store_api_requests; scope text:=komisio_private.store_api_write_scope(p_action);
 op uuid:=gen_random_uuid();
begin
 if scope is null then raise exception 'INVALID_INPUT'; end if;
 k:=komisio_private.claim_store_api_key(p_secret,scope);
 if p_replay is null or p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768
  or (p_action in ('editSeller','editItem','endItem'))<>(p_subject is not null) then raise exception 'INVALID_INPUT'; end if;
 if (p_body - (case p_action when 'createSeller' then array['name','email','phone'] when 'editSeller' then array['name','email','phone','expectedRevision']
  when 'createItem' then array['sellerId','title','priceMinor','bagId','categoryId'] when 'editItem' then array['title','expectedTitle','priceMinor','expectedPriceMinor','reason']
  when 'endItem' then array['endAction','reason'] when 'recordSale' then array['externalId','occurredAt','currency','lines'] else array['saleLineId','refundMinor','reason','occurredAt'] end)) <> '{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 select * into prior from komisio_private.store_api_requests where key_id=k.id and replay_id=p_replay;
 if found then
  if (prior.action,prior.subject,prior.body_digest) is distinct from (p_action,p_subject,extensions.digest(p_body::text,'sha256')) then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.id;
 end if;
 if (select count(*) from komisio_private.store_api_requests r join public.pending_operations o on o.id=r.id
  where r.key_id=k.id and o.expires_at>now() and not exists(select 1 from public.operation_decisions d where d.operation_id=o.id))>=200 then raise exception 'QUEUE_FULL'; end if;
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(op,k.tenant_id,'storeApiChange','high',jsonb_build_object('action',p_action),'agent',k.label,k.issued_by,now()+interval '7 days');
 insert into komisio_private.store_api_requests(id,key_id,replay_id,action,subject,body,body_digest) values(op,k.id,p_replay,p_action,p_subject,p_body,extensions.digest(p_body::text,'sha256'));
 return op;
end $$;

create function public.store_api_request_status(p_secret text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys:=komisio_private.claim_store_api_key(p_secret,null);
begin
 return (select jsonb_build_object('id',o.id,'action',r.action,'status',coalesce(d.outcome,case when o.expires_at<=now() then 'expired' else 'open' end),
  'resultId',d.result_id,'error',d.error_code)
  from komisio_private.store_api_requests r join public.pending_operations o on o.id=r.id
  left join public.operation_decisions d on d.operation_id=o.id where r.key_id=k.id and o.tenant_id=k.tenant_id and o.id=p_id);
end $$;

create function public.review_store_api_request(p_tenant uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select jsonb_build_object('action',r.action,'subject',r.subject,'body',r.body,
  'canApprove',o.proposed_by<>auth.uid() and o.expires_at>now() and k.revoked_at is null and k.expires_at>now()
  and exists(select 1 from public.tenant_members m where m.tenant_id=p_tenant and m.user_id=k.issued_by and m.role='owner'))
  from komisio_private.store_api_requests r join public.pending_operations o on o.id=r.id
  join komisio_private.store_inventory_keys k on k.id=r.key_id where r.id=p_id and o.tenant_id=p_tenant);
end $$;

create function komisio_private.execute_store_api_request(t uuid,op uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r komisio_private.store_api_requests; b jsonb; seller public.sellers; new_profile jsonb; sess uuid; item_result jsonb; lines jsonb;
begin
 if coalesce(public.tenant_role(t),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select r0.* into strict r from komisio_private.store_api_requests r0
 join komisio_private.store_inventory_keys k on k.id=r0.key_id and k.tenant_id=t
 join public.tenant_members m on m.tenant_id=t and m.user_id=k.issued_by and m.role='owner'
 join auth.users u on u.id=m.user_id and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 where r0.id=op and auth.uid()<>k.issued_by and k.revoked_at is null and k.expires_at>now() and komisio_private.store_api_write_scope(r0.action)=any(k.scopes);
 b:=r.body;
 case r.action
 when 'createSeller' then return public.register_seller(t,op,b->>'name',coalesce(b->>'email',''),coalesce(b->>'phone',''));
 when 'editSeller' then
  select * into strict seller from public.sellers where tenant_id=t and id=r.subject and privacy_closed_at is null;
  new_profile:=jsonb_build_object('sellerType',seller.seller_type,'name',seller.name,'email',seller.email,'phone',seller.phone,
   'addressLine1','','addressLine2','','postalCode','','city','','country','','language','','notes','')||coalesce(seller.profile,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('name',b->>'name','email',b->>'email','phone',b->>'phone'));
  perform public.save_seller_profile(t,op,r.subject,(b->>'expectedRevision')::integer,new_profile);
  return r.subject;
 when 'createItem' then
  if b->>'bagId' is null then sess:=public.create_reception_session(t,op,(b->>'sellerId')::uuid);
  else sess:=public.create_bag_reception(t,op,(b->>'sellerId')::uuid,(b->>'bagId')::uuid); end if;
  item_result:=public.quick_receive_categorized(t,op,sess,(b->>'sellerId')::uuid,0,jsonb_build_object('description',b->>'title'),
   (b->>'priceMinor')::bigint,(b->>'bagId')::uuid,null,null,(b->>'categoryId')::uuid);
  return (item_result->>'itemId')::uuid;
 when 'editItem' then
  if not (b ? 'title' or b ? 'priceMinor') then raise exception 'INVALID_INPUT'; end if;
  if b ? 'title' then
   if komisio_private.item_title(t,r.subject)->>'title' is distinct from b->>'expectedTitle' then raise exception 'ITEM_CHANGED'; end if;
   perform public.correct_item_attribute(t,op,r.subject,'description',b->>'title',b->>'reason');
  end if;
  if b ? 'priceMinor' then
   if b->>'expectedPriceMinor' is null then raise exception 'INVALID_INPUT'; end if;
   perform public.set_item_price_checked(t,op,r.subject,(b->>'priceMinor')::bigint,b->>'reason',(b->>'expectedPriceMinor')::bigint); end if;
  return r.subject;
 when 'endItem' then
  perform public.end_sale_period(t,op,r.subject,b->>'endAction',b->>'reason'); return r.subject;
 when 'recordSale' then
  if length(b->>'externalId') not between 1 and 185 then raise exception 'INVALID_INPUT'; end if;
  select jsonb_agg(jsonb_build_object('itemId',line->>'itemId','priceOre',(line->>'priceMinor')::bigint) order by ord)
   into lines from jsonb_array_elements(b->'lines') with ordinality a(line,ord);
  return public.record_sale(t,op,'manual','store-api:'||(b->>'externalId'),(b->>'occurredAt')::timestamptz,b->>'currency',lines,'{}'::jsonb);
 when 'recordReturn' then
  return public.record_return(t,op,(b->>'saleLineId')::uuid,(b->>'refundMinor')::bigint,b->>'reason',(b->>'occurredAt')::timestamptz);
 else raise exception 'INVALID_INPUT';
 end case;
exception when no_data_found then raise exception 'SUBJECT_OR_KEY_UNAVAILABLE';
when others then
 -- Only stable domain codes are visible in the decision and status endpoint.
 if sqlerrm ~ '^[A-Z][A-Z_0-9]{1,79}$' then raise; end if;
 raise exception 'REQUEST_FAILED';
end $$;
revoke all on function komisio_private.execute_store_api_request(uuid,uuid) from public,anon,authenticated;

do $$ declare src text; anchor text; begin
 src:=pg_get_functiondef('public.decide_operation(uuid,uuid,uuid,text,text)'::regprocedure);
 anchor:='   when ''acceptItem'' then result:=';
 if position(anchor in src)=0 then raise exception 'UNEXPECTED_DECISION_DISPATCH'; end if;
 if position(' if p_decision=''rejected'' then' in src)=0 then raise exception 'UNEXPECTED_DECISION_GUARD'; end if;
 src:=replace(src,' if p_decision=''rejected'' then',' if op.kind=''storeApiChange'' and coalesce(public.tenant_role(p_tenant),'''') not in (''owner'',''admin'') then raise exception ''FORBIDDEN'' using errcode=''42501''; end if;'||chr(10)||' if p_decision=''rejected'' then');
 execute replace(src,anchor,'   when ''storeApiChange'' then result:=komisio_private.execute_store_api_request(p_tenant,p_operation);'||chr(10)||anchor);
 src:=pg_get_functiondef('public.operation_queue_filtered_page(uuid,text,timestamptz,uuid,text)'::regprocedure);
 anchor:='''useAccountingDraft''))';
 if position(anchor in src)=0 then raise exception 'UNEXPECTED_QUEUE_FILTER'; end if;
 execute replace(src,anchor,'''useAccountingDraft'',''storeApiChange''))');
end $$;
revoke all on function public.store_api_records(text,text,integer,uuid,uuid),public.submit_store_api_request(text,uuid,text,uuid,jsonb),public.store_api_request_status(text,uuid),public.review_store_api_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.store_api_records(text,text,integer,uuid,uuid),public.submit_store_api_request(text,uuid,text,uuid,jsonb),public.store_api_request_status(text,uuid) to anon;
grant execute on function public.review_store_api_request(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
