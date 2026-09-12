import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const row = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  reference: z.union([z.number().int(), z.string()]),
  note: z.string(),
  custody_source: z.literal('staff_receipt'),
  received_at: z.iso.datetime({ offset: true }),
})
export type GarmentReceipt = z.infer<typeof row>

/** Custody fact for one reception session, or null. RLS scopes the read. */
export async function readGarmentReceipt(
  client: SupabaseClient,
  tenantInput: string,
  sessionInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    sessionId = z.uuid().parse(sessionInput)
  const { data, error } = await client
    .from('garment_receipts')
    .select('id,session_id,reference,note,custody_source,received_at')
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw new Error('Unable to read garment custody')
  return data ? row.parse(data) : null
}

/** Custody for many sessions in one query, keyed by session id. */
export async function readGarmentReceipts(
  client: SupabaseClient,
  tenantInput: string,
  sessionIds: string[],
) {
  const tenantId = z.uuid().parse(tenantInput)
  const ids = z.array(z.uuid()).max(50).parse(sessionIds)
  if (!ids.length) return new Map<string, GarmentReceipt>()
  const { data, error } = await client
    .from('garment_receipts')
    .select('id,session_id,reference,note,custody_source,received_at')
    .eq('tenant_id', tenantId)
    .in('session_id', ids)
  if (error) throw new Error('Unable to read garment custody')
  return new Map(
    z
      .array(row)
      .parse(data)
      .map((r) => [r.session_id, r]),
  )
}

export function garmentReference(reference: number | string) {
  return `G-${reference}`
}
