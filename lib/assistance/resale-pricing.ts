import { z } from 'zod'
import { locales } from '../i18n'
import { currencyCode } from '../engine/money'

export const resaleMarket = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: currencyCode,
  language: z.enum(locales),
})
export function resaleProfile(input: unknown) {
  const market = resaleMarket.parse(input)
  return {
    ...market,
    profile:
      market.country === 'SE' && market.currency === 'SEK'
        ? ('swedish-resale-pricing' as const)
        : null,
  }
}
const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/)
  .refine((v) => v !== '0.00')
const common = {
  id: z.uuid(),
  currency: currencyCode,
  amount,
  category: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(120).nullable(),
  condition: z.string().trim().min(1).max(400),
  observedAt: z.iso.datetime(),
}
export const resalePriceEvidence = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('store_sale'),
    tenantId: z.uuid(),
    saleId: z.uuid(),
    itemId: z.uuid(),
    soldAt: z.iso.datetime(),
    reversed: z.boolean(),
  }),
  z
    .strictObject({
      ...common,
      kind: z.literal('web_listing'),
      url: z.url().refine((value) => {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password
      }),
      marketCountry: z.string().regex(/^[A-Z]{2}$/),
      status: z.enum(['asking', 'sold', 'ended_unknown']),
      priceBasis: z.enum(['item_only', 'includes_fees_or_shipping', 'unknown']),
      verification: z.enum(['retrieved_page', 'search_snippet']),
      soldAt: z.iso.datetime().nullable(),
    })
    .refine((v) => v.status !== 'sold' || v.soldAt !== null),
])
export type ResalePriceEvidence = z.infer<typeof resalePriceEvidence>

/** Eligibility only, not valuation. Never fetch URLs or calculate money here. */
export function eligiblePriceEvidence(
  tenantId: string,
  marketInput: unknown,
  input: unknown,
) {
  z.uuid().parse(tenantId)
  const market = resaleMarket.parse(marketInput)
  const evidence = z.array(resalePriceEvidence).max(100).parse(input)
  if (new Set(evidence.map((e) => e.id)).size !== evidence.length)
    throw new Error('DUPLICATE_EVIDENCE')
  // A foreign record is a binding error, not an item to silently discard.
  if (evidence.some((e) => e.kind === 'store_sale' && e.tenantId !== tenantId))
    throw new Error('TENANT_MISMATCH')
  return evidence.filter(
    (e) =>
      e.currency === market.currency &&
      (e.kind === 'store_sale'
        ? !e.reversed
        : e.marketCountry === market.country &&
          e.verification === 'retrieved_page' &&
          e.priceBasis === 'item_only' &&
          e.status !== 'ended_unknown'),
  )
}
