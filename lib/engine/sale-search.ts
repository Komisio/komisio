import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
export const saleSearchRows = z
  .array(
    z.object({
      id: z.guid(),
      title: z.string(),
      priceOre: z.string().regex(/^\d+$/),
    }),
  )
  .max(21)
export type SaleSearchItem = z.infer<typeof saleSearchRows>[number]
export async function searchSaleItems(
  client: SupabaseClient,
  tenant: string,
  query: string,
) {
  const result = await client.rpc('sale_item_search', {
    p_tenant: z.uuid().parse(tenant),
    p_query: z.string().trim().min(2).max(120).parse(query),
  })
  if (result.error) throw new Error('SEARCH_FAILED')
  return saleSearchRows.parse(result.data)
}
