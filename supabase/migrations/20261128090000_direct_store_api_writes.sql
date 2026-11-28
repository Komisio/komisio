-- A null assurance level identifies a credential issued for reviewed submissions.
alter table komisio_private.store_inventory_keys
 add column issued_aal text check (issued_aal in ('aal1','aal2')),
 add unique (tenant_id,id);

create function komisio_private.guard_store_key_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.tenant_id,new.id,new.issued_by,new.issued_aal,new.secret_hash,new.scopes)
    is distinct from (old.tenant_id,old.id,old.issued_by,old.issued_aal,old.secret_hash,old.scopes) then
  raise exception 'STORE_KEY_BINDING_IMMUTABLE';
 end if;
 return new;
end $$;
revoke all on function komisio_private.guard_store_key_binding() from public,anon,authenticated;
create trigger immutable_key_binding before update of tenant_id,id,issued_by,issued_aal,secret_hash,scopes
 on komisio_private.store_inventory_keys for each row execute function komisio_private.guard_store_key_binding();

create or replace function public.store_inventory_keys(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'expiresAt',expires_at,'scopes',scopes) order by created_at,id),'[]'::jsonb)
  from komisio_private.store_inventory_keys where tenant_id=p_tenant and revoked_at is null and expires_at>now());
end $$;

create or replace function public.issue_store_inventory_key(p_tenant uuid,p_label text,p_scopes text[] default array['items:read']) returns text
language plpgsql security definer set search_path='' as $$
declare secret text; key_id uuid;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_label is null or length(trim(p_label)) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
 if (select count(*) from komisio_private.store_inventory_keys where tenant_id=p_tenant and revoked_at is null and expires_at>now())>=10 then raise exception 'KEY_LIMIT'; end if;
 secret:='kmi_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into komisio_private.store_inventory_keys(tenant_id,issued_by,label,scopes,secret_hash,issued_aal)
 values(p_tenant,auth.uid(),trim(p_label),p_scopes,extensions.digest(secret,'sha256'),
  case when auth.jwt()->>'aal'='aal2' then 'aal2' else 'aal1' end) returning id into key_id;
 perform komisio_private.record_access(p_tenant,'store_api.key_issued',key_id,'{}'::jsonb);
 return secret;
end $$;

create or replace function public.revoke_store_inventory_key(p_tenant uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update komisio_private.store_inventory_keys set revoked_at=now() where tenant_id=p_tenant and id=p_id and revoked_at is null;
 if found then perform komisio_private.record_access(p_tenant,'store_api.key_revoked',p_id,'{}'::jsonb); end if;
end $$;

create or replace function komisio_private.claim_store_api_key(p_secret text,p_scope text) returns komisio_private.store_inventory_keys
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; bucket timestamptz;
begin
 if p_secret is null or length(p_secret)<>68 or p_secret !~ '^kmi_[0-9a-f]{64}$' then raise exception 'INVALID_KEY'; end if;
 select s.* into k from komisio_private.store_inventory_keys s
 join public.tenant_members m on m.tenant_id=s.tenant_id and m.user_id=s.issued_by and (m.role='owner' or (m.role='admin' and s.issued_aal is not null))
 join auth.users u on u.id=m.user_id and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=statement_timestamp())
 where s.secret_hash=extensions.digest(p_secret,'sha256') and s.revoked_at is null and s.expires_at>statement_timestamp() and (s.issued_aal is null or s.issued_aal='aal2' or not exists
  (select 1 from auth.mfa_factors f where f.user_id=s.issued_by and f.status='verified')) for update of s;
 if not found then raise exception 'INVALID_KEY'; end if;
 if p_scope is not null and not(p_scope=any(k.scopes)) then raise exception 'INSUFFICIENT_SCOPE'; end if;
 bucket:=date_trunc('minute',clock_timestamp());
 if k.window_start=bucket and k.requests>=60 then raise exception 'RATE_LIMIT'; end if;
 update komisio_private.store_inventory_keys set window_start=bucket,requests=case when window_start=bucket then requests+1 else 1 end where id=k.id;
 return k;
end $$;
revoke all on function komisio_private.claim_store_api_key(text,text) from public,anon,authenticated;

-- Direct receipts share the business transaction. Retain the digest, never the contact payload.
create table komisio_private.store_api_write_receipts (
 id uuid primary key,
 tenant_id uuid not null,
 key_id uuid not null,
 replay_id uuid not null,
 action text not null,
 subject uuid,
 body_digest bytea not null,
 result_id uuid,
 error_code text,
 check ((result_id is null) <> (error_code is null)),
 unique (key_id,replay_id),
 foreign key (tenant_id,key_id) references komisio_private.store_inventory_keys(tenant_id,id)
);
alter table komisio_private.store_api_write_receipts enable row level security;
revoke all on komisio_private.store_api_write_receipts from public,anon,authenticated;
create trigger support_read_only_guard before insert or update or delete or truncate
 on komisio_private.store_api_write_receipts for each statement execute function komisio_private.guard_support_write();

create function komisio_private.store_api_receipt(r komisio_private.store_api_write_receipts) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',r.id,'action',r.action,'status',case when r.error_code is null then 'executed' else 'failed' end,
  'resultId',r.result_id,'error',r.error_code);
$$;
revoke all on function komisio_private.store_api_receipt(komisio_private.store_api_write_receipts) from public,anon,authenticated;

create function komisio_private.apply_store_api_command(t uuid,op uuid,action text,subject_id uuid,b jsonb) returns uuid
language plpgsql set search_path='' as $$
declare seller public.sellers; new_profile jsonb; sess uuid; item_result jsonb; lines jsonb;
begin
 case action
 when 'createSeller' then return public.register_seller(t,op,b->>'name',coalesce(b->>'email',''),coalesce(b->>'phone',''));
 when 'editSeller' then
  if b->>'expectedRevision' is null then raise exception 'INVALID_INPUT'; end if;
  select * into strict seller from public.sellers where tenant_id=t and id=subject_id and privacy_closed_at is null;
  new_profile:=jsonb_build_object('sellerType',seller.seller_type,'name',seller.name,'email',seller.email,'phone',seller.phone,
   'addressLine1','','addressLine2','','postalCode','','city','','country','','language','','notes','')||coalesce(seller.profile,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('name',b->>'name','email',b->>'email','phone',b->>'phone'));
  perform public.save_seller_profile(t,op,subject_id,(b->>'expectedRevision')::integer,new_profile);
  return subject_id;
 when 'createItem' then
  if b->>'bagId' is null then sess:=public.create_reception_session(t,op,(b->>'sellerId')::uuid);
  else sess:=public.create_bag_reception(t,op,(b->>'sellerId')::uuid,(b->>'bagId')::uuid); end if;
  item_result:=public.quick_receive_categorized(t,op,sess,(b->>'sellerId')::uuid,0,jsonb_build_object('description',b->>'title'),
   (b->>'priceMinor')::bigint,(b->>'bagId')::uuid,null,null,(b->>'categoryId')::uuid);
  return (item_result->>'itemId')::uuid;
 when 'editItem' then
  if not (b ? 'title' or b ? 'priceMinor') then raise exception 'INVALID_INPUT'; end if;
  if b ? 'title' then
   if not b ? 'expectedTitle' then raise exception 'INVALID_INPUT'; end if;
   if komisio_private.item_title(t,subject_id)->>'title' is distinct from b->>'expectedTitle' then raise exception 'ITEM_CHANGED'; end if;
   perform public.correct_item_attribute(t,op,subject_id,'description',b->>'title',b->>'reason');
  end if;
  if b ? 'priceMinor' then
   if b->>'expectedPriceMinor' is null then raise exception 'INVALID_INPUT'; end if;
   perform public.set_item_price_checked(t,op,subject_id,(b->>'priceMinor')::bigint,b->>'reason',(b->>'expectedPriceMinor')::bigint); end if;
  return subject_id;
 when 'endItem' then
  perform public.end_sale_period(t,op,subject_id,b->>'endAction',b->>'reason'); return subject_id;
 when 'recordSale' then
  if coalesce(length(trim(b->>'externalId')),0) not between 1 and 185 then raise exception 'INVALID_INPUT'; end if;
  select jsonb_agg(jsonb_build_object('itemId',line->>'itemId','priceOre',(line->>'priceMinor')::bigint) order by ord)
   into lines from jsonb_array_elements(b->'lines') with ordinality a(line,ord);
  return public.record_sale(t,op,'manual','store-api:'||(b->>'externalId'),(b->>'occurredAt')::timestamptz,b->>'currency',lines,'{}'::jsonb);
 when 'recordReturn' then
  return public.record_return(t,op,(b->>'saleLineId')::uuid,(b->>'refundMinor')::bigint,b->>'reason',(b->>'occurredAt')::timestamptz);
 else raise exception 'INVALID_INPUT';
 end case;
end $$;
revoke all on function komisio_private.apply_store_api_command(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;

create or replace function komisio_private.execute_store_api_request(t uuid,op uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r komisio_private.store_api_requests;
begin
 if coalesce(public.tenant_role(t),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select r0.* into strict r from komisio_private.store_api_requests r0
 join komisio_private.store_inventory_keys k on k.id=r0.key_id and k.tenant_id=t
 join public.tenant_members m on m.tenant_id=t and m.user_id=k.issued_by and m.role='owner'
 join auth.users u on u.id=m.user_id and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 where r0.id=op and auth.uid()<>k.issued_by and k.revoked_at is null and k.expires_at>now() and komisio_private.store_api_write_scope(r0.action)=any(k.scopes);
 return komisio_private.apply_store_api_command(t,op,r.action,r.subject,r.body);
exception when no_data_found then raise exception 'SUBJECT_OR_KEY_UNAVAILABLE';
when others then
 -- Only stable domain codes are visible in the decision and status endpoint.
 if sqlerrm ~ '^[A-Z][A-Z_0-9]{1,79}$' then raise; end if;
 raise exception 'REQUEST_FAILED';
end $$;

create or replace function public.store_api_request_status(p_secret text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys:=komisio_private.claim_store_api_key(p_secret,null);
begin
 if k.issued_aal is not null then
  return (select komisio_private.store_api_receipt(r) from komisio_private.store_api_write_receipts r
   where r.key_id=k.id and r.tenant_id=k.tenant_id and r.id=p_id);
 end if;
 return (select jsonb_build_object('id',o.id,'action',r.action,'status',coalesce(d.outcome,case when o.expires_at<=now() then 'expired' else 'open' end),
  'resultId',d.result_id,'error',d.error_code)
  from komisio_private.store_api_requests r join public.pending_operations o on o.id=r.id
  left join public.operation_decisions d on d.operation_id=o.id where r.key_id=k.id and o.tenant_id=k.tenant_id and o.id=p_id);
end $$;

-- Route old credentials through their original review contract including exact retries.
alter function public.submit_store_api_request(text,uuid,text,uuid,jsonb) set schema komisio_private;
alter function komisio_private.submit_store_api_request(text,uuid,text,uuid,jsonb) rename to submit_reviewed_store_api_request;
revoke all on function komisio_private.submit_reviewed_store_api_request(text,uuid,text,uuid,jsonb) from public,anon,authenticated;

create function public.write_store_api_record(p_secret text,p_replay uuid,p_action text,p_subject uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k komisio_private.store_inventory_keys; receipt komisio_private.store_api_write_receipts;
 scope text:=komisio_private.store_api_write_scope(p_action); digest bytea; op uuid;
 shop uuid; assurance text; previous_claims text:=current_setting('request.jwt.claims',true);
begin
 if scope is null then raise exception 'INVALID_INPUT'; end if;
 if p_secret is null or length(p_secret)<>68 then raise exception 'INVALID_KEY'; end if;
 select tenant_id,issued_aal into shop,assurance from komisio_private.store_inventory_keys
 where secret_hash=extensions.digest(p_secret,'sha256');
 if not found then raise exception 'INVALID_KEY'; end if;
 if assurance is null then
  op:=komisio_private.submit_reviewed_store_api_request(p_secret,p_replay,p_action,p_subject,p_body);
  return jsonb_build_object('id',op,'status','review');
 end if;

 -- Use the engine's tenant-before-key lock order for retries, membership changes and revocation.
 perform 1 from public.tenants where id=shop for update;
 k:=komisio_private.claim_store_api_key(p_secret,scope);
 if p_replay is null or p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>32768
  or (p_action in ('editSeller','editItem','endItem'))<>(p_subject is not null) then raise exception 'INVALID_INPUT'; end if;
 if (p_body - (case p_action when 'createSeller' then array['name','email','phone'] when 'editSeller' then array['name','email','phone','expectedRevision']
  when 'createItem' then array['sellerId','title','priceMinor','bagId','categoryId'] when 'editItem' then array['title','expectedTitle','priceMinor','expectedPriceMinor','reason']
  when 'endItem' then array['endAction','reason'] when 'recordSale' then array['externalId','occurredAt','currency','lines'] else array['saleLineId','refundMinor','reason','occurredAt'] end)) <> '{}'::jsonb then raise exception 'INVALID_INPUT'; end if;
 digest:=extensions.digest(p_body::text,'sha256');
 select * into receipt from komisio_private.store_api_write_receipts where key_id=k.id and replay_id=p_replay;
 if found then
  if (receipt.action,receipt.subject,receipt.body_digest) is distinct from (p_action,p_subject,digest) then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.store_api_receipt(receipt);
 end if;

 -- As with connector_call, delegate only the issuer's recorded assurance for one fixed engine command.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',k.issued_by,'role','authenticated','aal',k.issued_aal,
  'amr',jsonb_build_array(jsonb_build_object('method','store_api')),'store_api_key',k.id)::text,true);
 if coalesce(public.tenant_role(k.tenant_id),'') not in ('owner','admin') then raise exception 'INVALID_KEY'; end if;
 op:=gen_random_uuid();
 begin
  receipt.result_id:=komisio_private.apply_store_api_command(k.tenant_id,op,p_action,p_subject,p_body);
 exception
  when no_data_found then receipt.error_code:='SUBJECT_UNAVAILABLE';
  when raise_exception or insufficient_privilege then
   receipt.error_code:=case when sqlerrm ~ '^[A-Z][A-Z_0-9]{1,79}$' then sqlerrm else 'WRITE_REJECTED' end;
  when data_exception or integrity_constraint_violation then receipt.error_code:='INVALID_INPUT';
 end;
 insert into komisio_private.store_api_write_receipts(id,tenant_id,key_id,replay_id,action,subject,body_digest,result_id,error_code)
 values(op,k.tenant_id,k.id,p_replay,p_action,p_subject,digest,receipt.result_id,receipt.error_code) returning * into receipt;
 perform komisio_private.record_access(k.tenant_id,case when receipt.error_code is null then 'store_api.write_executed' else 'store_api.write_failed' end,op,
  jsonb_build_object('keyId',k.id,'action',p_action,'resultId',receipt.result_id,'error',receipt.error_code));
 perform set_config('request.jwt.claims',coalesce(nullif(previous_claims,''),'{}'),true);
 return komisio_private.store_api_receipt(receipt);
end $$;

-- Keep the original database client's UUID receipt contract.
create function public.submit_store_api_request(p_secret text,p_replay uuid,p_action text,p_subject uuid,p_body jsonb) returns uuid
language sql set search_path='' as $$
 select (public.write_store_api_record(p_secret,p_replay,p_action,p_subject,p_body)->>'id')::uuid;
$$;
revoke all on function public.write_store_api_record(text,uuid,text,uuid,jsonb),public.submit_store_api_request(text,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.write_store_api_record(text,uuid,text,uuid,jsonb),public.submit_store_api_request(text,uuid,text,uuid,jsonb) to anon;
