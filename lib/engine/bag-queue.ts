import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const reference = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
export const bagQueueNavigation = z
  .object({
    seller: z.uuid().optional(),
    bag: z
      .string()
      .trim()
      .max(20)
      .transform((value) => value.replace(/^k\s*-\s*/i, ''))
      .pipe(reference.or(z.literal('')))
      .optional(),
    older: reference.optional(),
    newer: reference.optional(),
  })
  .refine((v) => !(v.older && v.newer))

export function bagQueueHref(
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') query.set(key, String(value))
  return `/intake?${query.toString()}#bag-queue`
}

/** One bag as `bag_queue_page` returns it, seller name embedded. */
const bagQueueRow = z.object({
  id: z.guid(),
  seller_id: z.guid(),
  reference: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  note: z.string(),
  received_at: z.iso.datetime({ offset: true }),
  sellers: z.object({ name: z.string() }),
})

// Read with the caller's authenticated client; the function checks the store
// role. Fetch one extra row rather than issuing one count/query per bag.
export async function readBagQueue(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
) {
  const tenant = z.uuid().parse(tenantId)
  const filters = bagQueueNavigation.parse(input)
  const result = await client.rpc('bag_queue_page', {
    p_tenant: tenant,
    p_seller: filters.seller ?? null,
    p_reference: filters.bag || null,
    p_older: filters.older ?? null,
    p_newer: filters.newer ?? null,
  })
  if (result.error) throw new Error('Unable to load bag queue')
  const rows = z.array(bagQueueRow).max(21).parse(result.data ?? [])
  const items = rows.slice(0, 20)
  if (filters.newer) items.reverse()
  return {
    items,
    hasNewer: filters.newer ? rows.length > 20 : !!filters.older,
    hasOlder: filters.newer ? true : rows.length > 20,
  }
}
