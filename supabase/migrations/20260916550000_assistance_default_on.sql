-- Built-in assistance on by default for a new store (2026-09-16, owner
-- decision, replacing the P1 S9 default of off). It was off until a store
-- published a policy that turned it on, which meant a new store met the
-- reception screen with the AI button inert and nothing explaining why.
-- Assistance is the part of Komisio that saves a shop time, and every new
-- store has included credits to try it with.
--
-- This changes only the fallback a store uses before it has published
-- anything. A store that has published a policy keeps exactly what it
-- published: the key was absent there, so assistance stays off for it until
-- its owner publishes again with the box ticked. Nothing published is
-- rewritten.
--
-- The default is not an authority to spend. A person still starts every
-- analysis, the deployment must have a model configured at all, the store's
-- own monthly quota applies, and the credit reservation and the platform cap
-- are unchanged. An owner can untick it and publish.
--
-- The fallback is written out in two functions: the invoker-rights reader the
-- web uses and the definer-rights core the automation uses. They have to say
-- the same thing, so both are replaced here.

create or replace function public.current_store_policy(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 if coalesce(public.tenant_role(p_tenant),'') not in ('owner','admin','staff','readonly') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy',coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":["review_publication","acceptance"],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100,"assistanceEnabled":true}'::jsonb));
end $$;

create or replace function komisio_private.current_store_policy_core(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_version public.store_policy_versions;
begin
 select * into current_version from public.store_policy_versions where tenant_id=p_tenant order by version desc limit 1;
 return jsonb_build_object('id',current_version.id,'version',coalesce(current_version.version,0),'policy',coalesce(current_version.policy,
 '{"commissionBasis":"inclusive","commissionRatePercent":60,"agreementRequiredFor":["review_publication","acceptance"],"custodySources":["staff_receipt"],"sellerReviewMode":"delegated","salePeriodDays":42,"markdownSteps":[{"afterDays":14,"percent":10},{"afterDays":28,"percent":25},{"afterDays":42,"percent":50}],"endOfPeriodAction":"charity","unsoldNotifyAfterDays":60,"minPayoutThreshold":100,"assistanceEnabled":true}'::jsonb));
end $$;
