import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFortnoxStatus } from './fortnox-connection'

// Onboarding checklist (ONBOARDING-AND-PLANS.md, slice 2): the store's
// first steps, computed from facts that already exist. Nothing is stored
// for the checklist; a step is done when the fact behind it exists.
export const onboardingStepKeys = [
  'account',
  'store',
  'profile',
  'policy',
  'agreement',
  'seller',
  'item',
  'sale',
  'dayClose',
  'integrations',
  'team',
] as const
export type OnboardingStepKey = (typeof onboardingStepKeys)[number]
export type OnboardingFacts = {
  profileName: boolean
  policyVersions: number | null
  agreementVersions: number | null
  sellers: number | null
  items: number | null
  sales: number | null
  dayCloses: number | null
  fortnoxConnected: boolean | null
  zettleConnections: number | null
  members: number
}
export type OnboardingStep = {
  key: OnboardingStepKey
  done: boolean
  path: string
}

const paths: Record<OnboardingStepKey, string> = {
  account: '/account',
  store: '/settings?tab=store',
  profile: '/account',
  policy: '/settings',
  agreement: '/intake/agreements',
  seller: '/intake/sellers',
  item: '/intake',
  sale: '/intake/sales',
  dayClose: '/intake/accounting',
  integrations: '/intake/integrations',
  team: '/members',
}

/** Pure: facts in, ordered steps out. An unknown count (null) is not done. */
export function onboardingSteps(f: OnboardingFacts): OnboardingStep[] {
  const positive = (n: number | null) => (n ?? 0) > 0
  const done: Record<OnboardingStepKey, boolean> = {
    account: true,
    store: true,
    profile: f.profileName,
    policy: positive(f.policyVersions),
    agreement: positive(f.agreementVersions),
    seller: positive(f.sellers),
    item: positive(f.items),
    sale: positive(f.sales),
    dayClose: positive(f.dayCloses),
    integrations: f.fortnoxConnected === true || positive(f.zettleConnections),
    team: f.members > 1,
  }
  return onboardingStepKeys.map((key) => ({
    key,
    done: done[key],
    path: paths[key],
  }))
}

async function count(client: SupabaseClient, table: string, tenantId: string) {
  const r = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  return r.error ? null : (r.count ?? 0)
}

/** Facts under the caller's own session; a table the caller cannot read counts as unknown. */
export async function readOnboarding(
  client: SupabaseClient,
  tenantInput: string,
  context: { profileName: boolean; members: number },
) {
  const tenantId = z.uuid().parse(tenantInput)
  const [
    policyVersions,
    agreementVersions,
    sellers,
    items,
    sales,
    dayCloses,
    zettleConnections,
    fortnox,
  ] = await Promise.all([
    count(client, 'store_policy_versions', tenantId),
    count(client, 'seller_agreement_versions', tenantId),
    count(client, 'sellers', tenantId),
    count(client, 'items', tenantId),
    count(client, 'sales', tenantId),
    count(client, 'day_closes', tenantId),
    count(client, 'zettle_pull_connections', tenantId),
    readFortnoxStatus(client, tenantId).catch(() => null),
  ])
  return onboardingSteps({
    profileName: context.profileName,
    members: context.members,
    policyVersions,
    agreementVersions,
    sellers,
    items,
    sales,
    dayCloses,
    zettleConnections,
    fortnoxConnected: fortnox ? fortnox.connected : null,
  })
}
