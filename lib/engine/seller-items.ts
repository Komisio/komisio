import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Seller portal: the seller's own items with stage, price and sale facts,
// projected in SQL under the portal's identity check. Read only.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const myItems = z.object({
  currency: z.string(),
  items: z
    .array(
      z.object({
        id: z.guid(),
        reference: z.string(),
        acceptedAt: z.string(),
        title: z.string().nullable(),
        category: z.string().nullable(),
        currentPriceOre: ore.nullable(),
        acceptedPriceOre: ore.nullable(),
        stage: z.enum([
          'on_sale',
          'markdown_due',
          'period_ending',
          'period_ended',
          'ended',
          'sold',
        ]),
        periodEnd: z.string(),
        endOfPeriodAction: z.enum(['charity', 'return']).nullable(),
        endedAs: z.string().nullable(),
        soldAt: z.string().nullable(),
        soldPriceOre: ore.nullable(),
      }),
    )
    .max(200),
})
export type MyItems = z.infer<typeof myItems>

/** Null until the migration is live, so the portal renders without the section. */
export async function readMyItems(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const r = await client.rpc('my_items', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('Unable to read items')
  return myItems.parse(r.data)
}

/** What the seller sees: a store-internal stage becomes one of five plain states. */
export function sellerItemState(item: MyItems['items'][number]) {
  if (item.stage === 'sold') return 'sold' as const
  if (item.stage === 'ended') return 'ended' as const
  if (item.stage === 'period_ended') return 'periodEnded' as const
  if (item.stage === 'period_ending') return 'periodEnding' as const
  return 'forSale' as const
}
