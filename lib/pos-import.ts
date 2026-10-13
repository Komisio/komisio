import { z } from 'zod'

export const posProvider = z.enum(['paypal', 'shopify'])
export type PosProvider = z.infer<typeof posProvider>
export const posProduct = z.strictObject({
  productId: z.string().min(1).max(200),
  variantId: z.string().min(1).max(200),
  title: z.string().min(1).max(1000),
  sku: z.string().max(200).nullable(),
  barcode: z.string().max(200).nullable(),
  priceOre: z.number().int().min(0).max(99999999).nullable(),
  currency: z.string().length(3).nullable(),
  quantity: z.number().int().nullable(),
  active: z.boolean(),
})
export type PosProduct = z.infer<typeof posProduct>
export const posChoice = z.object({
  id: z.uuid(),
  title: z.string(),
  reference: z.string(),
  ownership: z.enum(['consignment', 'store']),
  seller: z.string().nullable(),
  priceOre: z.number().int(),
})
export type PosChoice = z.infer<typeof posChoice>
export const posReviewRow = z.object({
  product: posProduct,
  token: z.string(),
  linked: posChoice.nullable(),
  suggestions: z.array(posChoice).max(10),
})
export type PosReviewRow = z.infer<typeof posReviewRow>
export const posPage = z.object({
  account: z.string(),
  rows: z.array(posReviewRow).max(500),
  next: z.string().nullable(),
})
export const posCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    tenantId: z.uuid(),
    provider: posProvider,
    cursor: z.string().max(2000).nullable(),
  }),
  z.strictObject({
    action: z.literal('search'),
    tenantId: z.uuid(),
    query: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    action: z.literal('prepare'),
    tenantId: z.uuid(),
    token: z.string().max(12000),
    sellerId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('commit'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    token: z.string().max(12000),
    mode: z.enum(['create', 'link']),
    itemId: z.uuid().nullable(),
    sellerId: z.uuid().nullable(),
    context: z.string().max(64).nullable(),
    received: z.boolean(),
  }),
])
export type PosCommand = z.infer<typeof posCommand>
export const posResult = z.object({
  requestId: z.uuid(),
  item: posChoice,
  created: z.boolean(),
})

/** Quantities greater than one cannot identify an individual consignment item. */
export function canImportPosProduct(p: PosProduct, currency: string) {
  return (
    p.active &&
    p.priceOre !== null &&
    p.priceOre > 0 &&
    p.currency === currency &&
    (p.quantity === null || p.quantity === 1)
  )
}
