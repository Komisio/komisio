import { z } from 'zod'
const catalogVariant = z.strictObject({
  uuid: z.uuid(),
  sku: z.string().max(64),
  barcode: z.string().max(128),
  price: z.strictObject({
    amount: z.number().int().min(1).max(99999999999),
    currencyId: z.literal('SEK'),
  }),
})
export const catalogProduct = z.strictObject({
  uuid: z.uuid(),
  name: z.string().min(1).max(120),
  externalReference: z.string().regex(/^komisio:[0-9a-f-]{36}$/),
  vatPercentage: z.number().min(0).max(100),
  variants: z.tuple([catalogVariant]),
})
export type CatalogProduct = z.infer<typeof catalogProduct>
/** Compare only our managed fields; provider read-only metadata is not copied back. */
export function sameProduct(a: CatalogProduct, b: CatalogProduct) {
  return (
    a.uuid === b.uuid &&
    a.name === b.name &&
    a.externalReference === b.externalReference &&
    a.vatPercentage === b.vatPercentage &&
    a.variants[0].uuid === b.variants[0].uuid &&
    a.variants[0].sku === b.variants[0].sku &&
    a.variants[0].barcode === b.variants[0].barcode &&
    a.variants[0].price.amount === b.variants[0].price.amount &&
    a.variants[0].price.currencyId === b.variants[0].price.currencyId
  )
}
export function projectRemoteProduct(input: unknown): CatalogProduct {
  const remote = z
    .object({
      ...catalogProduct.shape,
      variants: z.array(z.object(catalogVariant.shape)).length(1),
    })
    .passthrough()
    .parse(input)
  // A full PUT must not erase externally added categories, images, descriptions or options.
  const empty = (v: unknown) =>
    v == null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && v !== null && Object.keys(v).length === 0)
  const allowed = new Set([
    'uuid',
    'name',
    'externalReference',
    'vatPercentage',
    'variants',
    'etag',
    'created',
    'updated',
    'updatedBy',
  ])
  if (Object.entries(remote).some(([k, v]) => !allowed.has(k) && !empty(v)))
    throw new Error('ZETTLE_REMOTE_CHANGED')
  const variant = (input as { variants: Record<string, unknown>[] }).variants[0]
  if (
    Object.entries(variant).some(
      ([k, v]) => !['uuid', 'sku', 'barcode', 'price'].includes(k) && !empty(v),
    )
  )
    throw new Error('ZETTLE_REMOTE_CHANGED')
  return catalogProduct.parse({
    uuid: remote.uuid,
    name: remote.name,
    externalReference: remote.externalReference,
    vatPercentage: remote.vatPercentage,
    variants: remote.variants,
  })
}
