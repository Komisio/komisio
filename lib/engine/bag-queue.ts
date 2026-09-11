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

// Read with the caller's authenticated client; tenant filtering supplements RLS.
// Fetch one extra row rather than issuing one count/query per bag.
export async function readBagQueue(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
) {
  const tenant = z.uuid().parse(tenantId)
  const filters = bagQueueNavigation.parse(input)
  let query = client
    .from('bag_receipts')
    .select('id,seller_id,reference,note,received_at,sellers(name)')
    .eq('tenant_id', tenant)
    .order('reference', { ascending: !!filters.newer })
    .limit(21)
  if (filters.seller) query = query.eq('seller_id', filters.seller)
  if (filters.bag) query = query.eq('reference', filters.bag)
  if (filters.older) query = query.lt('reference', filters.older)
  if (filters.newer) query = query.gt('reference', filters.newer)
  const result = await query
  if (result.error) throw new Error('Unable to load bag queue')
  const items = (result.data ?? []).slice(0, 20)
  // Fail explicitly rather than round a database bigint into an incorrect cursor.
  for (const item of items)
    z.number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(item.reference)
  if (filters.newer) items.reverse()
  return {
    items,
    hasNewer: filters.newer ? result.data.length > 20 : !!filters.older,
    hasOlder: filters.newer ? true : result.data.length > 20,
  }
}
