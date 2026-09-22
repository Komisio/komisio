import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pilotEnvironment,
  verifyPilotConnection,
} from '../../extensions/zettle/auth'
import { open, seal, sealedBox } from '../platform/credentials'

export const paypalCredentials = z.strictObject({
  clientId: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
  apiKey: z.string().trim().min(1).max(32768),
})
const purpose = (tenantId: string) => `paypal-credentials:${tenantId}`

/** Database authorization precedes decryption. Deployment credentials remain tenant-bound. */
export async function paypalEnvironment(
  client: SupabaseClient,
  tenantId: string,
  source: Record<string, string | undefined>,
) {
  z.uuid().parse(tenantId)
  const result = await client.rpc('read_paypal_credentials', {
    p_tenant: tenantId,
  })
  if (result.error) throw new Error('FORBIDDEN')
  if (!result.data) return pilotEnvironment(source)
  const row = z
    .object({ merchantId: z.uuid(), cipher: sealedBox })
    .parse(result.data)
  const credentials = paypalCredentials.parse(
    open(purpose(tenantId), row.cipher, source),
  )
  return {
    ZETTLE_PILOT_TENANT_ID: tenantId,
    ZETTLE_MERCHANT_ID: row.merchantId,
    ZETTLE_CLIENT_ID: credentials.clientId,
    ZETTLE_API_KEY: credentials.apiKey,
  }
}

export async function connectPayPal(
  client: SupabaseClient,
  tenantId: string,
  input: z.infer<typeof paypalCredentials>,
  source: Record<string, string | undefined>,
  http?: typeof fetch,
) {
  z.uuid().parse(tenantId)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  const credentials = paypalCredentials.parse(input)
  // Seal before any provider request, so a missing host key cannot partially connect.
  const cipher = seal(purpose(tenantId), credentials, source)
  const verified = await verifyPilotConnection(
    tenantId,
    {
      ZETTLE_PILOT_TENANT_ID: tenantId,
      ZETTLE_CLIENT_ID: credentials.clientId,
      ZETTLE_API_KEY: credentials.apiKey,
    },
    http,
  )
  const saved = await client.rpc('store_paypal_credentials', {
    p_tenant: tenantId,
    p_merchant: verified.organizationId,
    p_cipher: cipher,
  })
  if (saved.error)
    throw new Error(
      saved.error.message === 'ZETTLE_WRONG_MERCHANT'
        ? 'ZETTLE_WRONG_MERCHANT'
        : 'ZETTLE_CONNECTION_FAILED',
    )
  return { organizationId: verified.organizationId, merchantPinned: true }
}
