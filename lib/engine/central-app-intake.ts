import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const settings = z.object({ tenantId: z.uuid().nullable(), revision: z.uuid() })
export type CentralAppSettings = z.infer<typeof settings>
export const centralAppCommand = z.strictObject({
  action: z.literal('centralAppIntake'),
  id: z.uuid(),
  expected: z.uuid(),
  tenantId: z.uuid().nullable(),
})
export const centralAppErrorCodes = [
  'FORBIDDEN',
  'SUPPORT_READ_ONLY',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'REQUEST_CHANGED',
  'SEK_REQUIRED',
  'PLAN_READ_ONLY',
]
export async function readCentralAppIntake(client: SupabaseClient) {
  const r = await client.rpc('host_central_app_intake')
  if (r.error) throw new Error('Unable to read central app recipient')
  return settings.parse(r.data)
}
export async function setCentralAppIntake(
  client: SupabaseClient,
  input: unknown,
) {
  const c = centralAppCommand.parse(input)
  const r = await client.rpc('set_central_app_intake', {
    p_id: c.id,
    p_expected: c.expected,
    p_tenant: c.tenantId,
  })
  if (r.error)
    throw new Error(
      centralAppErrorCodes.includes(r.error.message)
        ? r.error.message
        : 'REQUEST_FAILED',
    )
  return settings.parse(r.data)
}
