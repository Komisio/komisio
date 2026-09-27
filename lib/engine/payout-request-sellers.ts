import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellersOverview } from './sellers'
import { readSellerBalance } from './seller-ledger'

// The sellers the payouts page may request on behalf of: the first fifty by
// name with their available balance. One overview read gives all fifty
// balances in one call; the older path (a table read plus one balance call
// per seller) remains only for a database without the overview function.
// Zero balances are returned as they are; the page decides what to offer.
export type PayoutRequestSeller = {
  id: string
  name: string
  availableOre: number
}

const sellerRow = z.object({ id: z.uuid(), name: z.string() })

export async function readPayoutRequestSellers(
  client: SupabaseClient,
  tenantInput: string,
): Promise<PayoutRequestSeller[]> {
  const tenant = z.uuid().parse(tenantInput)
  // Ordered by name then id inside the read; a forbidden, network or schema
  // error throws here and is never mistaken for an empty list.
  const overview = await readSellersOverview(client, tenant, '', 50)
  if (overview)
    return overview.sellers.map(({ id, name, availableOre }) => ({
      id,
      name,
      availableOre,
    }))
  // The overview function is not deployed (PGRST202 only): the compatibility path.
  const rows = await client
    .from('sellers')
    .select('id,name')
    .eq('tenant_id', tenant)
    .order('name')
    .order('id')
    .limit(50)
  if (rows.error) throw new Error('Unable to read sellers')
  const sellers = z.array(sellerRow).parse(rows.data)
  return Promise.all(
    sellers.map(async (s) => ({
      ...s,
      availableOre: (await readSellerBalance(client, tenant, s.id))
        .availableOre,
    })),
  )
}
