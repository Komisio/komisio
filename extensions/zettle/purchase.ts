import { z } from 'zod'
const money = z.number().int().min(-99_999_999_999).max(99_999_999_999)
const product = z.object({
  productUuid: z.uuid().nullable().optional(),
  variantUuid: z.uuid().nullable().optional(),
  quantity: z.string().max(32),
  type: z.string().max(40),
  unitPrice: money,
  name: z.string().max(1000).optional(),
  sku: z.string().max(500).optional(),
  barcode: z.string().max(500).optional(),
  comment: z.string().max(2000).optional(),
  discount: z.unknown().optional(),
  discountValue: money.optional(),
})
const wire = z.object({
  purchaseUUID1: z.uuid(),
  timestamp: z.string().max(64),
  amount: money,
  currency: z.string().max(10),
  source: z.string().max(40),
  products: z.array(product).min(1).max(50),
  refund: z.boolean().optional(),
  refunded: z.boolean().optional(),
  refundsPurchaseUUID1: z.string().optional(),
  discounts: z.array(z.unknown()).max(50).optional(),
  serviceCharge: z.unknown().optional(),
})
export const importLine = z.strictObject({
  productUuid: z.uuid().nullable().optional(),
  variantUuid: z.uuid().nullable().optional(),
  lineNo: z.number().int().min(1).max(50),
  reference: z
    .string()
    .regex(/^I-[0-9A-F]{8}$/)
    .nullable(),
  labelConflict: z.boolean(),
  description: z.string().max(120),
  priceOre: money,
})
export const importPurchase = z.strictObject({
  externalId: z.uuid(),
  occurredAt: z.iso.datetime(),
  amountOre: money,
  currency: z.string().max(10),
  blockedReason: z
    .enum([
      'source',
      'refund',
      'currency',
      'discount',
      'service_charge',
      'quantity',
      'product_type',
      'amount',
    ])
    .nullable(),
  lines: z.array(importLine).min(1).max(50),
})
export type ImportedPurchase = z.infer<typeof importPurchase>
/** Only documented Purchase API fields; discard payment/customer/employee/location data. */
export function mapZettlePurchase(input: unknown): ImportedPurchase {
  const p = wire.parse(input)
  const stamp = z.iso
    .datetime({ offset: true })
    .parse(p.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  const lines = p.products.map((row, i) => {
    const refs = [
      ...new Set(
        [row.sku, row.barcode, row.comment]
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim().toUpperCase())
          .filter((v) => /^I-[0-9A-F]{8}$/.test(v)),
      ),
    ]
    return {
      ...(row.productUuid
        ? { productUuid: row.productUuid.toLowerCase() }
        : {}),
      ...(row.variantUuid
        ? { variantUuid: row.variantUuid.toLowerCase() }
        : {}),
      lineNo: i + 1,
      reference: refs.length === 1 ? refs[0] : null,
      labelConflict: refs.length > 1,
      description: (row.name ?? '').slice(0, 120),
      priceOre: row.unitPrice,
    }
  })
  const blockedReason =
    p.source !== 'POS'
      ? 'source'
      : p.refund || p.refunded || p.refundsPurchaseUUID1 || p.amount < 0
        ? 'refund'
        : p.currency !== 'SEK'
          ? 'currency'
          : p.discounts?.length ||
              p.products.some((r) => r.discount != null || !!r.discountValue)
            ? 'discount'
            : p.serviceCharge != null
              ? 'service_charge'
              : p.products.some((r) => !/^1(?:\.0+)?$/.test(r.quantity))
                ? 'quantity'
                : p.products.some(
                      (r) => !['PRODUCT', 'CUSTOM_AMOUNT'].includes(r.type),
                    )
                  ? 'product_type'
                  : p.amount <= 0 ||
                      lines.some((l) => l.priceOre <= 0) ||
                      lines.reduce((sum, l) => sum + BigInt(l.priceOre), 0n) !==
                        BigInt(p.amount)
                    ? 'amount'
                    : null
  return importPurchase.parse({
    externalId: p.purchaseUUID1.toLowerCase(),
    occurredAt: new Date(stamp).toISOString(),
    amountOre: p.amount,
    currency: p.currency,
    blockedReason,
    lines,
  })
}
export const cursor = z.string().min(1).max(1000).nullable()
const page = z.object({
  purchases: z.array(z.unknown()).max(100),
  lastPurchaseHash: z.string().max(1000).nullish(),
})
export function mapZettlePage(input: unknown, previous: string | null) {
  const p = page.parse(input),
    purchases = p.purchases.map(mapZettlePurchase)
  if (new Set(purchases.map((p) => p.externalId)).size !== purchases.length)
    throw new Error('ZETTLE_DUPLICATE_PURCHASE')
  if (
    purchases.length &&
    (!p.lastPurchaseHash || p.lastPurchaseHash === previous)
  )
    throw new Error('ZETTLE_CURSOR_STALLED')
  return {
    purchases,
    nextCursor: purchases.length ? p.lastPurchaseHash! : previous,
  }
}
