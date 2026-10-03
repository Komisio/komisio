import { z } from 'zod'
import { saleProvider } from '../engine/sales'

export const receiptSearch = z.object({
  reference: z.string().trim().max(200).default(''),
  provider: saleProvider.or(z.literal('')).default(''),
})

/** Only known receipt filters travel between the list and its detail pages. */
export function receiptSearchQuery(input: unknown = {}) {
  const search = receiptSearch.parse(input)
  const query = new URLSearchParams()
  if (search.reference) query.set('reference', search.reference)
  if (search.provider) query.set('provider', search.provider)
  return query.size ? `?${query.toString()}` : ''
}
