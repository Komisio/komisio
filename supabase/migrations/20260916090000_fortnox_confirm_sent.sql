alter table public.fortnox_voucher_sends
 add column reconciled_by uuid references auth.users(id),
 add column reconciled_at timestamptz,
 add column reconciliation_evidence text not null default '' check(length(reconciliation_evidence)<=500),
 add constraint fortnox_reconciliation_complete check(
  (reconciled_by is null and reconciled_at is null and reconciliation_evidence='') or
  (reconciled_by is not null and reconciled_at is not null and length(trim(reconciliation_evidence))>0 and status='sent')
 );

create or replace function komisio_private.guard_fortnox_send() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_SEND' using errcode='55000'; end if;
 if new.id<>old.id or new.tenant_id<>old.tenant_id or new.export_id<>old.export_id or new.database_number<>old.database_number or new.actor<>old.actor or new.created_at<>old.created_at then
  raise exception 'IMMUTABLE_SEND' using errcode='55000';
 end if;
 if current_setting('komisio.fortnox_transition',true)='reconcile_sent' then
  if old.reconciled_by is not null or not(old.status='pending' or (old.status='failed' and old.error_code='FORTNOX_OUTCOME_UNKNOWN'))
   or new.status<>'sent' or new.reconciled_by is null or new.reconciled_at is null then
   raise exception 'IMMUTABLE_SEND' using errcode='55000';
  end if;
 else
  if current_setting('komisio.fortnox_transition',true) is distinct from 'engine' or old.status<>'pending' or new.status='pending'
   or new.reconciled_by is distinct from old.reconciled_by or new.reconciled_at is distinct from old.reconciled_at
   or new.reconciliation_evidence is distinct from old.reconciliation_evidence then
   raise exception 'IMMUTABLE_SEND' using errcode='55000';
  end if;
 end if;
 return new;
end $$;

create function public.reconcile_fortnox_send(p_tenant uuid,p_send_id uuid,p_outcome text,p_voucher_series text,p_voucher_number integer,p_financial_year integer,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=komisio_private.require_identity(); prior public.fortnox_voucher_sends; result public.fortnox_voucher_sends;
 series text:=trim(coalesce(p_voucher_series,'')); evidence text:=trim(coalesce(p_evidence,''));
begin
 perform 1 from public.tenants where id=p_tenant for update;
 if coalesce(public.tenant_role(p_tenant),'')<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_send_id is null or p_outcome is distinct from 'confirmed_sent' or length(series) not between 1 and 10
  or p_voucher_number is null or p_voucher_number<=0 or p_financial_year is null or p_financial_year<=0
  or length(evidence) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 select * into prior from public.fortnox_voucher_sends where tenant_id=p_tenant and id=p_send_id;
 if not found then raise exception 'SEND_NOT_FOUND'; end if;
 if prior.reconciled_by is not null then
  if prior.reconciled_by<>uid or prior.voucher_series<>series or prior.voucher_number<>p_voucher_number
   or prior.financial_year<>p_financial_year or prior.reconciliation_evidence<>evidence then raise exception 'REQUEST_CONFLICT'; end if;
  return komisio_private.fortnox_send_state(prior);
 end if;
 if not(prior.status='pending' or (prior.status='failed' and prior.error_code='FORTNOX_OUTCOME_UNKNOWN')) then raise exception 'SEND_NOT_PENDING'; end if;
 perform set_config('komisio.fortnox_transition','reconcile_sent',true);
 update public.fortnox_voucher_sends set status='sent',voucher_series=series,voucher_number=p_voucher_number,financial_year=p_financial_year,
  completed_at=now(),reconciled_by=uid,reconciled_at=now(),reconciliation_evidence=evidence
 where id=prior.id returning * into result;
 perform set_config('komisio.fortnox_transition','',true);
 perform komisio_private.record_access(p_tenant,'fortnox.reconciled',prior.export_id,jsonb_build_object(
  'send_id',prior.id,'database_number',prior.database_number,'outcome','confirmed_sent','prior_status',prior.status,
  'prior_error_code',prior.error_code,'voucher_series',series,'voucher_number',p_voucher_number,'financial_year',p_financial_year,'evidence',evidence));
 return komisio_private.fortnox_send_state(result);
end $$;
revoke all on function public.reconcile_fortnox_send(uuid,uuid,text,text,integer,integer,text) from public,anon;
grant execute on function public.reconcile_fortnox_send(uuid,uuid,text,text,integer,integer,text) to authenticated;
