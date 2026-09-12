import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { operationRow, operationStatus } from './operations'

export const operationFilter = z.enum(['all', ...operationStatus.options])
export const operationPageInput = z
  .strictObject({
    status: operationFilter.default('all'),
    // Preserve database microseconds; parsing through Date would round the cursor.
    beforeCreated: z.iso.datetime({ offset: true }).max(40).optional(),
    beforeId: z.uuid().optional(),
  })
  .refine((c) => !!c.beforeCreated === !!c.beforeId)

export async function readOperationPage(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown = {},
) {
  const c = operationPageInput.parse(input)
  const { data, error } = await client.rpc('operation_queue_page', {
    p_tenant: z.uuid().parse(tenantInput),
    p_status: c.status,
    p_before_created: c.beforeCreated ?? null,
    p_before_id: c.beforeId ?? null,
  })
  if (error) throw new Error('Unable to read operation queue')
  const rows = z.array(operationRow).max(21).parse(data),
    items = rows.slice(0, 20)
  const last = items.at(-1)
  return {
    items,
    status: c.status,
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    nextBefore:
      rows.length > 20 && last
        ? { beforeCreated: last.created_at, beforeId: last.id }
        : null,
  }
}
