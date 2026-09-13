import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  verifyPilotConnection,
  type PilotEnvironment,
} from '../../extensions/zettle/auth'
export async function checkZettleConnection(
  client: SupabaseClient,
  tenantId: string,
  env: PilotEnvironment,
  http?: typeof fetch,
) {
  z.uuid().parse(tenantId)
  // Database membership/MFA is checked before touching any credential or provider.
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  return verifyPilotConnection(tenantId, env, http)
}
