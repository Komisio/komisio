import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Plans and trial (owner decisions C1 to C6): the store's commercial state,
// read by every member; manual activation and the overview for platform
// hosts; closing by the owner. No provider in this slice.
export const planStates = [
  'free',
  'trial',
  'active',
  'past_due',
  'read_only',
  'closed',
] as const
export const planStatus = z.object({
  billing: z.boolean(),
  state: z.enum(planStates),
  writable: z.boolean(),
  provider: z.enum(['none', 'manual', 'stripe']).optional(),
  trialEndsAt: z.string().nullable().optional(),
  graceEndsAt: z.string().nullable().optional(),
  activeUntil: z.string().nullable().optional(),
  daysLeft: z.number().int().nullable().optional(),
})
export type PlanStatus = z.infer<typeof planStatus>

/** Null while the RPC is not migrated (deploy gap): the page shows no banner. */
export async function readPlanStatus(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('plan_status', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return planStatus.parse(r.data)
}

export async function isPlatformHost(client: SupabaseClient) {
  const r = await client.rpc('is_platform_host')
  return r.error ? false : r.data === true
}

const overviewRow = z.object({
  tenant_id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  state: z.enum(planStates),
  provider: z.enum(['none', 'manual', 'stripe']),
  trial_ends_at: z.string().nullable(),
  grace_ends_at: z.string().nullable(),
  active_until: z.string().nullable(),
  created_at: z.string(),
})
export type PlanOverviewRow = z.infer<typeof overviewRow>

export async function readHostOverview(client: SupabaseClient) {
  const r = await client.rpc('host_plan_overview')
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(overviewRow).parse(r.data)
}

export const activatePlanCommand = z.strictObject({
  action: z.literal('activatePlan'),
  tenantId: z.uuid(),
  until: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().trim().min(1).max(500),
})

export async function activatePlanManually(
  client: SupabaseClient,
  input: z.infer<typeof activatePlanCommand>,
) {
  const r = await client.rpc('activate_plan_manually', {
    p_tenant: input.tenantId,
    p_until: input.until,
    p_reason: input.reason,
  })
  if (r.error) throw new Error(r.error.message)
  return planStatus.parse(r.data)
}

export async function closeStore(
  client: SupabaseClient,
  tenantInput: string,
  reason: string,
) {
  const r = await client.rpc('close_store', {
    p_tenant: z.uuid().parse(tenantInput),
    p_reason: z.string().trim().min(1).max(500).parse(reason),
  })
  if (r.error) throw new Error(r.error.message)
  return planStatus.parse(r.data)
}

export const planErrorCodes = [
  'FORBIDDEN',
  'BILLING_DISABLED',
  'PLAN_CLOSED',
  'PLAN_READ_ONLY',
  'TENANT_NOT_FOUND',
  'INVALID_INPUT',
] as const
export function planErrorCode(message: string) {
  return planErrorCodes.find((c) => c === message) ?? 'REQUEST_FAILED'
}

// Usage per store for the host page: counts only, no store content.
export const activityRow = z.object({
  tenant_id: z.uuid(),
  members: z.number().int(),
  sellers: z.number().int(),
  items: z.number().int(),
  sales_30d: z.number().int(),
  last_activity: z.string().nullable(),
})
export type ActivityRow = z.infer<typeof activityRow>

/** Activity per store keyed by tenant id; empty until the migration reaches the database. */
export async function readHostActivity(client: SupabaseClient) {
  const r = await client.rpc('host_activity_overview')
  if (r.error?.code === 'PGRST202') return new Map<string, ActivityRow>()
  if (r.error) throw new Error('FORBIDDEN')
  return new Map(
    z
      .array(activityRow)
      .parse(r.data)
      .map((row) => [row.tenant_id, row]),
  )
}
