import { storeCurrencies } from '../platform/currencies'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatSignedOre } from './seller-ledger'

// One currency per store (decided 2026-09-13): the store policy names it,
// every money fact records it, and it is frozen once money facts exist.
// Amounts stay integers in the currency's minor unit; nothing converts.
export const currencyCode = z.enum(storeCurrencies)
export type CurrencyCode = z.infer<typeof currencyCode>

/** "123.45 NOK" from minor units; the code comes from the store, never a default in a page. */
export function formatMoney(ore: number, currency: string) {
  return `${formatSignedOre(ore)} ${currency}`
}

/** The store's currency; any signed-in person may read it (sellers included). */
export async function readStoreCurrency(
  client: SupabaseClient,
  tenantInput: string,
) {
  const result = await client.rpc('store_currency', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (result.error) throw new Error('FORBIDDEN')
  return currencyCode.parse(result.data)
}
