import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const sellerChoice = z.object({ id: z.uuid(), name: z.string() })

/** Minimal tenant-scoped labels only; never load balances or contact details. */
export async function readItemSellerChoices(
  client: SupabaseClient,
  tenantInput: string,
) {
  const tenant = z.uuid().parse(tenantInput)
  const sellers: z.infer<typeof sellerChoice>[] = []
  // PostgREST caps each response. Continue instead of silently losing sellers.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from('sellers')
      .select('id,name')
      .eq('tenant_id', tenant)
      .order('name')
      .order('id')
      .range(offset, offset + 499)
    if (error) throw new Error('Unable to read seller filter choices')
    const batch = z.array(sellerChoice).parse(data)
    sellers.push(...batch)
    if (batch.length < 500) return sellers
  }
}
