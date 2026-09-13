-- P3 store profile: one versioned public-facing document per store (address,
-- contact, opening hours, what the store accepts, concept text). Owner or
-- admin publish a version naming the current one; every version stays. The
-- profile is public by definition: anyone may read the current version by
-- store slug. The staged kind updateStoreProfile (low) lets an agent propose
-- the next version; execution is the ordinary publish, so a staff approver
-- records a failed outcome and changes nothing.
create function komisio_private.valid_store_profile(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare h jsonb; n integer:=0; a jsonb; c jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['address','contact','openingHours','accepts','concept','language']) or (value-array['address','contact','openingHours','accepts','concept','language'])<>'{}'::jsonb then return false; end if;
 a:=value->'address';
 if jsonb_typeof(a)<>'object' or not(a ?& array['street','postalCode','city']) or (a-array['street','postalCode','city'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(a->'street')<>'string' or length(a->>'street')>120 or jsonb_typeof(a->'postalCode')<>'string' or length(a->>'postalCode')>20 or jsonb_typeof(a->'city')<>'string' or length(a->>'city')>120 then return false; end if;
 c:=value->'contact';
 if jsonb_typeof(c)<>'object' or not(c ?& array['email','phone','website']) or (c-array['email','phone','website'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(c->'email')<>'string' or length(c->>'email')>254 or (c->>'email'<>'' and c->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then return false; end if;
 if jsonb_typeof(c->'phone')<>'string' or length(c->>'phone')>40 then return false; end if;
 if jsonb_typeof(c->'website')<>'string' or length(c->>'website')>200 or (c->>'website'<>'' and c->>'website' !~ '^https://[^\s]+$') then return false; end if;
 if jsonb_typeof(value->'openingHours')<>'array' or jsonb_array_length(value->'openingHours')>7 then return false; end if;
 for h in select * from jsonb_array_elements(value->'openingHours') loop
  n:=n+1;
  if jsonb_typeof(h)<>'object' or not(h ?& array['day','opens','closes']) or (h-array['day','opens','closes'])<>'{}'::jsonb then return false; end if;
  if h->>'day' not in ('mon','tue','wed','thu','fri','sat','sun') then return false; end if;
  if jsonb_typeof(h->'opens')<>'string' or (h->>'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(h->'closes')<>'string' or (h->>'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (h->>'opens')>=(h->>'closes') then return false; end if;
 end loop;
 if (select count(distinct e->>'day') from jsonb_array_elements(value->'openingHours') e)<>n then return false; end if;
 if jsonb_typeof(value->'accepts')<>'string' or length(value->>'accepts')>2000 or jsonb_typeof(value->'concept')<>'string' or length(value->>'concept')>2000 then return false; end if;
 if value->>'language' not in ('sv','en') then return false; end if;
 return true;
end $$;
revoke all on function komisio_private.valid_store_profile(jsonb) from public,anon,authenticated;

create table public.store_profile_versions (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 version integer not null check(version>0),
 previous_id uuid,
 profile jsonb not null check(komisio_private.valid_store_profile(profile)),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,version),
 foreign key(tenant_id,previous_id) references public.store_profile_versions(tenant_id,id)
);
alter table public.store_profile_versions enable row level security;
revoke all on public.store_profile_versions from public,anon,authenticated;
grant select on public.store_profile_versions to authenticated;
create policy store_profile_read on public.store_profile_versions for select to authenticated using(tenant_id in(select public.user_tenant_ids()));
create trigger store_profile_versions_immutable before update or delete on public.store_profile_versions for each row execute function komisio_private.preserve_payout_event();

-- Members read the current version with its id, so a publish can name it.
create function public.current_store_profile(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v public.store_profile_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into v from public.store_profile_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',v.id,'version',coalesce(v.version,0),'profile',v.profile,'publishedAt',v.created_at);
end $$;
revoke all on function public.current_store_profile(uuid) from public,anon;
grant execute on function public.current_store_profile(uuid) to authenticated;

-- The public read: store name and current profile by slug, nothing about
-- members, sellers or versions history. Null when the store has no profile.
create function public.public_store_profile(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.tenants; v public.store_profile_versions;
begin
 if p_slug is null or length(p_slug) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 select * into t from public.tenants where slug=p_slug;
 if not found then return null; end if;
 select * into v from public.store_profile_versions where tenant_id=t.id order by version desc limit 1;
 if not found then return null; end if;
 return jsonb_build_object('name',t.name,'slug',t.slug,'version',v.version,'profile',v.profile,'publishedAt',v.created_at);
end $$;
revoke all on function public.public_store_profile(text) from public;
grant execute on function public.public_store_profile(text) to anon,authenticated;

create function public.publish_store_profile(p_tenant uuid,p_id uuid,p_expected_current uuid,p_profile jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.store_profile_versions; current_version public.store_profile_versions;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or not komisio_private.valid_store_profile(p_profile) then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.store_profile_versions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.created_by is distinct from uid
   or prior.previous_id is distinct from p_expected_current or prior.profile is distinct from p_profile then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into current_version from public.store_profile_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from p_expected_current then raise exception 'PROFILE_CHANGED'; end if;
 insert into public.store_profile_versions(id,tenant_id,version,previous_id,profile,created_by) values(p_id,p_tenant,coalesce(current_version.version,0)+1,p_expected_current,p_profile,uid);
 perform komisio_private.record_access(p_tenant,'store_profile.published',p_id,jsonb_build_object('version',coalesce(current_version.version,0)+1));
 return p_id;
end $$;
revoke all on function public.publish_store_profile(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.publish_store_profile(uuid,uuid,uuid,jsonb) to authenticated;

-- Staged kind updateStoreProfile (low): the next version proposed by an agent.
alter table public.pending_operations drop constraint pending_operations_kind_check;
alter table public.pending_operations add constraint pending_operations_kind_check check(kind in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts','updateStoreProfile'));

create or replace function komisio_private.operation_risk(p_kind text) returns text
language plpgsql immutable set search_path='' as $$
begin
 case p_kind
  when 'publishReceptionReview' then return 'low';
  when 'saveInspectionDraft' then return 'low';
  when 'acceptItem' then return 'medium';
  when 'recordReturn' then return 'medium';
  when 'adjustLedger' then return 'high';
  when 'applyMarkdownBatch' then return 'low';
  when 'bulkItemUpdate' then return 'medium';
  when 'approvePayout' then return 'medium';
  when 'markPayoutPaid' then return 'medium';
  when 'sendMessage' then return 'low';
  when 'exportDayClose' then return 'medium';
  when 'recordZettlePurchase' then return 'medium';
  when 'settlePayouts' then return 'medium';
  when 'updateStoreProfile' then return 'low';
  else raise exception 'INVALID_INPUT';
 end case;
end $$;

create function komisio_private.op_validate_update_store_profile(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if value is null or jsonb_typeof(value)<>'object' then return false; end if;
 if not(value ?& array['expectedCurrentId','profile']) or (value-array['expectedCurrentId','profile'])<>'{}'::jsonb then return false; end if;
 if value->'expectedCurrentId'<>'null'::jsonb and (jsonb_typeof(value->'expectedCurrentId')<>'string' or (value->>'expectedCurrentId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
 return komisio_private.valid_store_profile(value->'profile');
end $$;
create function komisio_private.op_preflight_update_store_profile(p_tenant uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_version public.store_profile_versions;
begin
 select * into current_version from public.store_profile_versions where tenant_id=p_tenant order by version desc limit 1;
 if current_version.id is distinct from (p_payload->>'expectedCurrentId')::uuid then raise exception 'PROFILE_CHANGED'; end if;
 return jsonb_build_object('current_version',coalesce(current_version.version,0));
end $$;
create function komisio_private.op_execute_update_store_profile(p_tenant uuid,p_operation uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.publish_store_profile(p_tenant,p_operation,(p_payload->>'expectedCurrentId')::uuid,p_payload->'profile');
end $$;
revoke all on function komisio_private.op_validate_update_store_profile(jsonb),komisio_private.op_preflight_update_store_profile(uuid,jsonb),komisio_private.op_execute_update_store_profile(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function komisio_private.valid_operation_payload(p_kind text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 case p_kind
  when 'publishReceptionReview' then return komisio_private.op_validate_publish_reception_review(value);
  when 'saveInspectionDraft' then return komisio_private.op_validate_save_inspection_draft(value);
  when 'acceptItem' then return komisio_private.op_validate_accept_item(value);
  when 'recordReturn' then return komisio_private.op_validate_record_return(value);
  when 'adjustLedger' then return komisio_private.op_validate_adjust_ledger(value);
  when 'applyMarkdownBatch' then return komisio_private.op_validate_apply_markdown_batch(value);
  when 'bulkItemUpdate' then return komisio_private.op_validate_bulk_item_update(value);
  when 'approvePayout' then return komisio_private.op_validate_approve_payout(value);
  when 'markPayoutPaid' then return komisio_private.op_validate_mark_payout_paid(value);
  when 'sendMessage' then return komisio_private.op_validate_send_message(value);
  when 'exportDayClose' then return komisio_private.op_validate_export_day_close(value);
  when 'recordZettlePurchase' then return komisio_private.op_validate_zettle_purchase(value);
  when 'settlePayouts' then return komisio_private.op_validate_settle_payouts(value);
  when 'updateStoreProfile' then return komisio_private.op_validate_update_store_profile(value);
  else return false;
 end case;
end $$;

create or replace function public.propose_operation(p_tenant uuid,p_id uuid,p_kind text,p_payload jsonb,p_actor_label text,p_expires timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.pending_operations; label text:=trim(p_actor_label); risk text; detail jsonb;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_kind is null or label is null or length(label) not between 1 and 100
  or p_expires is null or not isfinite(p_expires) or not komisio_private.valid_operation_payload(p_kind,p_payload) then raise exception 'INVALID_INPUT'; end if;
 risk:=komisio_private.operation_risk(p_kind);
 select * into prior from public.pending_operations where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.kind is distinct from p_kind or prior.payload is distinct from p_payload
   or prior.proposed_by is distinct from uid or prior.actor_label is distinct from label or prior.expires_at is distinct from p_expires then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 if p_expires<=now() or p_expires>now()+interval '7 days' then raise exception 'INVALID_INPUT'; end if;
 case p_kind
  when 'publishReceptionReview' then detail:=komisio_private.op_preflight_publish_reception_review(p_tenant,p_payload);
  when 'saveInspectionDraft' then detail:=komisio_private.op_preflight_save_inspection_draft(p_tenant,p_payload);
  when 'acceptItem' then detail:=komisio_private.op_preflight_accept_item(p_tenant,p_payload);
  when 'recordReturn' then detail:=komisio_private.op_preflight_record_return(p_tenant,p_payload);
  when 'adjustLedger' then detail:=komisio_private.op_preflight_adjust_ledger(p_tenant,p_payload);
  when 'applyMarkdownBatch' then detail:=komisio_private.op_preflight_apply_markdown_batch(p_tenant,p_payload);
  when 'bulkItemUpdate' then detail:=komisio_private.op_preflight_bulk_item_update(p_tenant,p_payload);
  when 'approvePayout' then detail:=komisio_private.op_preflight_payout(p_tenant,p_payload,'requested');
  when 'markPayoutPaid' then detail:=komisio_private.op_preflight_payout(p_tenant,p_payload,'approved');
  when 'sendMessage' then detail:=komisio_private.op_preflight_send_message(p_tenant,p_payload);
  when 'exportDayClose' then detail:=komisio_private.op_preflight_export_day_close(p_tenant,p_payload);
  when 'recordZettlePurchase' then detail:=komisio_private.op_preflight_zettle_purchase(p_tenant,p_payload);
  when 'settlePayouts' then detail:=komisio_private.op_preflight_settle_payouts(p_tenant,p_payload);
  when 'updateStoreProfile' then detail:=komisio_private.op_preflight_update_store_profile(p_tenant,p_payload);
  else raise exception 'INVALID_INPUT';
 end case;
 insert into public.pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
 values(p_id,p_tenant,p_kind,risk,p_payload,'agent',label,uid,p_expires);
 perform komisio_private.record_access(p_tenant,'operation.proposed',p_id,jsonb_build_object('kind',p_kind,'actor_label',label)||detail);
 return p_id;
end $$;

create or replace function public.decide_operation(p_tenant uuid,p_id uuid,p_operation uuid,p_decision text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.operation_decisions; op public.pending_operations; note text:=coalesce(trim(p_reason),''); result uuid; failure text;
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_operation is null or p_decision is null or p_decision not in ('approved','rejected') or length(note)>500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.operation_decisions where id=p_id;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.operation_id is distinct from p_operation or prior.decision is distinct from p_decision
   or prior.decided_by is distinct from uid or prior.reason is distinct from note then raise exception 'REQUEST_CONFLICT'; end if;
  return p_id;
 end if;
 select * into op from public.pending_operations where id=p_operation and tenant_id=p_tenant;
 if not found then raise exception 'OPERATION_NOT_FOUND'; end if;
 if exists(select 1 from public.operation_decisions where operation_id=p_operation) then raise exception 'OPERATION_DECIDED'; end if;
 if p_decision='rejected' then
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,reason,decided_by) values(p_id,p_tenant,p_operation,'rejected','rejected',note,uid);
  perform komisio_private.record_access(p_tenant,'operation.decided',p_operation,jsonb_build_object('decision','rejected','outcome','rejected'));
  return p_id;
 end if;
 if op.expires_at<=now() then raise exception 'OPERATION_EXPIRED'; end if;
 -- Only low-risk kinds may be approved by the same person whose session proposed them.
 if op.risk_level<>'low' and op.proposed_by=uid then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 begin
  case op.kind
   when 'publishReceptionReview' then result:=komisio_private.op_execute_publish_reception_review(p_tenant,p_operation,op.payload);
   when 'saveInspectionDraft' then result:=komisio_private.op_execute_save_inspection_draft(p_tenant,p_operation,op.payload);
   when 'acceptItem' then result:=komisio_private.op_execute_accept_item(p_tenant,p_operation,op.payload);
   when 'recordReturn' then result:=komisio_private.op_execute_record_return(p_tenant,p_operation,op.payload);
   when 'adjustLedger' then result:=komisio_private.op_execute_adjust_ledger(p_tenant,p_operation,op.payload);
   when 'applyMarkdownBatch' then result:=komisio_private.op_execute_apply_markdown_batch(p_tenant,p_operation,op.payload);
   when 'bulkItemUpdate' then result:=komisio_private.op_execute_bulk_item_update(p_tenant,p_operation,op.payload);
   when 'approvePayout' then result:=komisio_private.op_execute_approve_payout(p_tenant,p_operation,op.payload);
   when 'markPayoutPaid' then result:=komisio_private.op_execute_mark_payout_paid(p_tenant,p_operation,op.payload);
   when 'sendMessage' then result:=komisio_private.op_execute_send_message(p_tenant,p_operation,op.payload);
   when 'exportDayClose' then result:=komisio_private.op_execute_export_day_close(p_tenant,p_operation,op.payload);
   when 'recordZettlePurchase' then result:=komisio_private.op_execute_zettle_purchase(p_tenant,p_operation,op.payload);
   when 'settlePayouts' then result:=komisio_private.op_execute_settle_payouts(p_tenant,p_operation,op.payload);
   when 'updateStoreProfile' then result:=komisio_private.op_execute_update_store_profile(p_tenant,p_operation,op.payload);
   else raise exception 'INVALID_INPUT';
  end case;
 exception when others then
  failure:=left(sqlerrm,100);
 end;
 if failure is null then
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,result_id,reason,decided_by) values(p_id,p_tenant,p_operation,'approved','executed',result,note,uid);
 else
  insert into public.operation_decisions(id,tenant_id,operation_id,decision,outcome,error_code,reason,decided_by) values(p_id,p_tenant,p_operation,'approved','failed',failure,note,uid);
 end if;
 perform komisio_private.record_access(p_tenant,'operation.decided',p_operation,jsonb_build_object('decision','approved','outcome',case when failure is null then 'executed' else 'failed' end,'error',coalesce(failure,'')));
 return p_id;
end $$;

create or replace function public.operation_queue_filtered_page(p_tenant uuid,p_status text,p_before_created timestamptz,p_before_id uuid,p_kind text)
returns table(id uuid,kind text,risk_level text,actor_kind text,actor_label text,proposed_by uuid,payload jsonb,expires_at timestamptz,created_at timestamptz,
 status text,decision_id uuid,outcome text,result_id uuid,error_code text,reason text,decided_by uuid,decided_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (p_kind is not null and p_kind not in ('publishReceptionReview','saveInspectionDraft','acceptItem','recordReturn','adjustLedger','applyMarkdownBatch','bulkItemUpdate','approvePayout','markPayoutPaid','sendMessage','exportDayClose','recordZettlePurchase','settlePayouts','updateStoreProfile'))
  or p_status is null or p_status not in ('all','open','expired','executed','failed','rejected')
  or (p_before_created is null)<>(p_before_id is null)
  or (p_before_created is not null and not isfinite(p_before_created)) then raise exception 'INVALID_INPUT'; end if;
 return query
 select o.id,o.kind,o.risk_level,o.actor_kind,o.actor_label,o.proposed_by,o.payload,o.expires_at,o.created_at,
  case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end,
  d.id,d.outcome,d.result_id,d.error_code,d.reason,d.decided_by,d.created_at
 from public.pending_operations o left join public.operation_decisions d on d.operation_id=o.id
 where o.tenant_id=p_tenant
  and (p_kind is null or o.kind=p_kind)
  and (p_before_created is null or (o.created_at,o.id)<(p_before_created,p_before_id))
  and (p_status='all' or (case when d.id is null and o.expires_at<=now() then 'expired' when d.id is null then 'open' else d.outcome end)=p_status)
 order by o.created_at desc,o.id desc limit 21;
end $$;
