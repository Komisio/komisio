import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const hostSupportState = z.object({
  id: z.uuid(),
  reason: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
  serverNow: z.string(),
  available: z.boolean(),
  tenant: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    role: z.literal('readonly'),
  }),
})
export type HostSupportState = z.infer<typeof hostSupportState>
export const hostSupportCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('start'),
    id: z.uuid(),
    tenantId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  }),
  z.strictObject({ action: z.literal('end'), id: z.uuid() }),
])

export async function readHostSupport(client: SupabaseClient) {
  const result = await client.rpc('host_support_context')
  // A deploy gap grants nothing. Other failures must not restore membership.
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('SUPPORT_CONTEXT_FAILED')
  return hostSupportState.nullable().parse(result.data)
}

export async function executeHostSupport(
  client: SupabaseClient,
  input: z.infer<typeof hostSupportCommand>,
) {
  const command = hostSupportCommand.parse(input)
  const result =
    command.action === 'start'
      ? await client.rpc('start_host_support', {
          p_id: command.id,
          p_tenant: command.tenantId,
          p_reason: command.reason,
        })
      : await client.rpc('end_host_support', { p_id: command.id })
  if (result.error) throw new Error(result.error.message)
  return command.action === 'start' ? hostSupportState.parse(result.data) : null
}
