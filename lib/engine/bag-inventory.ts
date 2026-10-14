import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readItemDirectory, type ItemSort } from './item-directory'
export async function readBagInventory(
  client: SupabaseClient,
  tenant: string,
  bag: string,
  offset: number,
  sort: ItemSort = 'accepted',
  direction: 'asc' | 'desc' = 'desc',
) {
  const skip = z.number().int().nonnegative().multipleOf(25).parse(offset)
  const result = await readItemDirectory(
    client,
    tenant,
    { bag: z.uuid().parse(bag) },
    sort,
    direction,
    skip / 25 + 1,
  )
  if (!result) throw new Error('Unable to read registered handover items')
  return result
}
export type BagInventoryPage = Awaited<ReturnType<typeof readBagInventory>>
