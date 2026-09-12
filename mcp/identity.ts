import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'

export async function requireMCPIdentity(
  client: SupabaseClient,
  config: MCPConfig,
  required: MCPConfig['scopes'][number],
) {
  if (!config.scopes.includes(required)) throw new Error('SCOPE_REQUIRED')
  const identity = await client.auth.getUser(config.token)
  if (identity.error || !identity.data.user?.email_confirmed_at)
    throw new Error('AUTH_REQUIRED')
  const role = await client.rpc('tenant_role', { p_tenant: config.tenantId })
  if (
    role.error ||
    !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
  )
    throw new Error('FORBIDDEN')
  return identity.data.user.id
}
