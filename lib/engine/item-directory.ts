import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { itemStage, originKind } from './items'
import { paypalItemState, paypalSyncStatus } from './paypal-status'
import { itemSyncConnections, itemSyncStatus, syncProvider } from './item-sync'

export const itemSort = z.enum([
  'title',
  'category',
  'seller',
  'price',
  'stage',
  'accepted',
  'periodEnd',
])
const text = z.string().trim().max(120)
const money = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/)
const date = z.iso.date().refine((value) => !value.startsWith('0000-'))
export const itemFilters = z
  .strictObject({
    q: text.optional(),
    stage: itemStage.optional(),
    ownership: z.enum(['consignment', 'store']).optional(),
    seller: text.optional(),
    category: text.optional(),
    minPrice: money.optional(),
    maxPrice: money.optional(),
    acceptedFrom: date.optional(),
    acceptedTo: date.optional(),
    endsBefore: date.optional(),
    photo: z.enum(['yes', 'no']).optional(),
    origin: originKind.optional(),
    paypal: paypalSyncStatus.optional(),
    syncProvider: syncProvider.optional(),
    syncStatus: itemSyncStatus.optional(),
  })
  .refine(
    (f) => !f.acceptedFrom || !f.acceptedTo || f.acceptedFrom <= f.acceptedTo,
  )
  .refine((f) => {
    if (
      (f.minPrice && !money.safeParse(f.minPrice).success) ||
      (f.maxPrice && !money.safeParse(f.maxPrice).success)
    )
      return false
    const ore = (v: string) => {
      const [whole, fraction = ''] = v.split('.')
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    }
    return !f.minPrice || !f.maxPrice || ore(f.minPrice) <= ore(f.maxPrice)
  })
export type ItemFilters = z.infer<typeof itemFilters>
export type ItemSort = z.infer<typeof itemSort>
export const filterKeys = [
  'q',
  'stage',
  'ownership',
  'seller',
  'category',
  'minPrice',
  'maxPrice',
  'acceptedFrom',
  'acceptedTo',
  'endsBefore',
  'photo',
  'origin',
  'paypal',
  'syncProvider',
  'syncStatus',
] as const
const item = z.object({
  id: z.guid(),
  title: z.string().nullable(),
  category: z.string().nullable(),
  sellerId: z.guid().nullable(),
  sellerName: z.string().nullable(),
  ownership: z.enum(['consignment', 'store']),
  originKind,
  acceptedAt: z.string(),
  periodEnd: z.string(),
  currentPriceOre: z.number().int().safe().nullable(),
  stage: itemStage,
  defaultPhotoId: z.guid().nullable(),
  photoCount: z.number().int().nonnegative(),
  nextMarkdownAt: z.string().nullable(),
  nextMarkdownPercent: z.number().nullable(),
  paypal: paypalItemState.optional(),
  sync: itemSyncConnections.optional(),
})
export type DirectoryItem = z.infer<typeof item>
export async function readItemDirectory(
  client: SupabaseClient,
  tenantId: string,
  filters: ItemFilters,
  sort: ItemSort,
  direction: 'asc' | 'desc',
  page: number,
) {
  const result = await client.rpc('items_search_page', {
    p_tenant: z.uuid().parse(tenantId),
    p_filters: itemFilters.parse(filters),
    p_sort: itemSort.parse(sort),
    p_direction: z.enum(['asc', 'desc']).parse(direction),
    p_limit: 25,
    p_offset: (z.number().int().min(1).max(9999999).parse(page) - 1) * 25,
  })
  // Never silently return unfiltered results while this read is unavailable.
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('Unable to read item directory')
  return z
    .object({
      currency: z.string(),
      items: z.array(item).max(25),
      total: z.number().int().nonnegative(),
      limit: z.literal(25),
      offset: z.number().int().nonnegative(),
    })
    .parse(result.data)
}
