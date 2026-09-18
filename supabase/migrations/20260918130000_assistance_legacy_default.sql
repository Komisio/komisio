-- Default missing AI preference on in effective reads; never rewrite published policy.
create or replace function public.current_store_policy(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy','{"assistanceEnabled":true}'::jsonb || coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":[],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100,"assistanceEnabled":true}'::jsonb));
end $$;

create or replace function komisio_private.current_store_policy_core(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy','{"assistanceEnabled":true}'::jsonb || coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":[],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100,"assistanceEnabled":true}'::jsonb));
end $$;
