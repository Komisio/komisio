import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Automation actor (owner decision D1): an owner enables a named scope for
// the deployment's automation identity; the identity accepts the grant on
// its next run, which creates its `automation` membership; disabling removes
// it. The identity's e-mail comes from server configuration, never from a
// form.
export const automationScopes = [
  'zettle_pull',
  'fortnox_send',
  'weekly_brief',
] as const
export type AutomationScope = (typeof automationScopes)[number]
export const automationGrant = z.object({
  id: z.uuid(),
  scope: z.enum(automationScopes),
  enabledAt: z.string(),
  accepted: z.boolean(),
  acceptedAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
})
export type AutomationGrant = z.infer<typeof automationGrant>

export function automationIdentity(
  env: Record<string, string | undefined> = process.env,
) {
  const email = env.KOMISIO_AUTOMATION_EMAIL?.trim().toLowerCase() ?? ''
  const password = env.KOMISIO_AUTOMATION_PASSWORD ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 16)
    return null
  return { email, password }
}

/** Active grants of a store; owner or admin. Null while the RPC is not migrated (deploy gap). */
export async function readAutomation(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('automation_status', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(automationGrant).parse(r.data)
}

export async function enableAutomation(
  client: SupabaseClient,
  tenantInput: string,
  requestInput: string,
  scope: AutomationScope,
  env: Record<string, string | undefined> = process.env,
) {
  const identity = automationIdentity(env)
  if (!identity) throw new Error('AUTOMATION_NOT_CONFIGURED')
  const r = await client.rpc('enable_automation', {
    p_tenant: z.uuid().parse(tenantInput),
    p_id: z.uuid().parse(requestInput),
    p_scope: z.enum(automationScopes).parse(scope),
    p_identity_email: identity.email,
  })
  if (r.error) throw new Error(r.error.message)
  return automationGrant.parse(r.data)
}

export async function disableAutomation(
  client: SupabaseClient,
  tenantInput: string,
  scope: AutomationScope,
) {
  const r = await client.rpc('disable_automation', {
    p_tenant: z.uuid().parse(tenantInput),
    p_scope: z.enum(automationScopes).parse(scope),
  })
  if (r.error) throw new Error(r.error.message)
  return { disabled: r.data === true }
}

/** Called by the automation identity itself at the start of a run. */
export async function acceptAutomationGrants(client: SupabaseClient) {
  const r = await client.rpc('accept_automation_grants')
  if (r.error) throw new Error(r.error.message)
  return z
    .array(z.object({ tenantId: z.uuid(), scope: z.enum(automationScopes) }))
    .parse(r.data)
}

export const automationErrorCodes = [
  'FORBIDDEN',
  'AUTOMATION_NOT_CONFIGURED',
  'AUTOMATION_ALREADY_ENABLED',
  'AUTOMATION_IDENTITY_IS_MEMBER',
  'AUTOMATION_MEMBERSHIP',
  'REQUEST_CONFLICT',
  'INVALID_INPUT',
] as const
