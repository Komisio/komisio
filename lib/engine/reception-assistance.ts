import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
export const assistanceCommand = z.strictObject({
  mode: z.enum(['single', 'batch']).optional(),
  tenantId: z.uuid(),
  sessionId: z.guid(),
  requestId: z.uuid(),
  revision: z.number().int().min(1).max(2147483646),
})
export async function reserveReceptionAssistance(
  client: SupabaseClient,
  input: unknown,
  model: string,
  prompt: string,
) {
  const c = assistanceCommand.parse(input)
  const result = await client.rpc('reserve_reception_assistance', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_session: c.sessionId,
    p_revision: c.revision,
    p_model: model,
    p_prompt: prompt,
  })
  if (result.error) {
    if (
      [
        'ASSISTANCE_LIMIT',
        'USAGE_QUOTA_EXCEEDED',
        'RECEPTION_CHANGED',
        'REQUEST_CONFLICT',
        'FORBIDDEN',
      ].includes(result.error.message)
    )
      throw new Error(result.error.message)
    throw new Error('ASSISTANCE_FAILED')
  }
  return result.data === true
}
