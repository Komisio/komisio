import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const weblinkCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('register'),
    tenantId: z.uuid(),
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().max(80),
    dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]),
  }),
  z.strictObject({
    action: z.literal('resolve'),
    tenantId: z.uuid(),
    id: z.uuid(),
    resolution: z.enum(['printed', 'cancelled']),
    note: z.string().trim().min(1).max(500),
    inspected: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('revoke'),
    tenantId: z.uuid(),
    id: z.uuid(),
  }),
])
export const weblinkErrors = [
  'INVALID_INPUT',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'REQUEST_CONFLICT',
  'PRINT_JOB_NOT_FOUND',
  'PRINT_ATTEMPT_CONFLICT',
  'PRINT_JOB_DECIDED',
  'PRINT_DEVICE_STILL_ACTIVE',
  'DEVICE_NOT_FOUND',
] as const

/** Use the member's session; SQL independently enforces tenant, role and fencing. */
export async function manageWeblink(
  client: SupabaseClient,
  input: z.input<typeof weblinkCommand>,
) {
  const c = weblinkCommand.parse(input)
  const result =
    c.action === 'register'
      ? await client.rpc('register_weblink_printer', {
          p_tenant: c.tenantId,
          p_id: c.id,
          p_name: c.name,
          p_model: c.model,
          p_dpi: c.dpi,
        })
      : c.action === 'resolve'
        ? await client.rpc('resolve_weblink_print_job', {
            p_tenant: c.tenantId,
            p_job: c.id,
            p_resolution: c.resolution,
            p_note: c.note,
          })
        : await client.rpc('revoke_print_device', {
            p_tenant: c.tenantId,
            p_device: c.id,
          })
  if (result.error)
    throw new Error(
      weblinkErrors.find((code) => result.error!.message === code) ??
        'REQUEST_FAILED',
    )
  if (c.action === 'revoke' ? result.data !== true : result.data !== c.id)
    throw new Error('REQUEST_FAILED')
  return { ok: true, id: c.id }
}
