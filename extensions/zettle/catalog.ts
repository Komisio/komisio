import { storeCurrencies } from '../../lib/platform/currencies'
import { z } from 'zod'
const catalogVariant = z.strictObject({
  uuid: z.uuid(),
  sku: z.string().max(64),
  barcode: z.string().max(128),
  price: z.strictObject({
    amount: z.number().int().min(1).max(99999999999),
    currencyId: z.enum(storeCurrencies),
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
export function projectRemoteProduct(
  input: unknown,
  purpose: 'read' | 'update' = 'update',
): CatalogProduct {
  const parsed = z
    .object({
      ...catalogProduct.shape,
      vatPercentage: z.union([
        catalogProduct.shape.vatPercentage,
        z
          .string()
          .regex(/^[0-9]{1,3}(\.[0-9]{1,4})?$/)
          .transform(Number)
          .pipe(catalogProduct.shape.vatPercentage),
      ]),
      variants: z.array(z.object(catalogVariant.shape)).length(1),
    })
    .passthrough()
    .safeParse(input)
  if (!parsed.success)
    throw new ProductReadError(
      'ZETTLE_PRODUCT_RESPONSE_INVALID',
      parsed.error.issues.flatMap((i) =>
        i.path.filter((p): p is string => typeof p === 'string'),
      ),
    )
  const remote = parsed.data
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
  const unsupported = Object.entries(remote)
    .filter(([k, v]) => !allowed.has(k) && !empty(v))
    .map(([k]) => k)
  const variant = (input as { variants: Record<string, unknown>[] }).variants[0]
  unsupported.push(
    ...Object.entries(variant)
      .filter(
        ([k, v]) =>
          !['uuid', 'sku', 'barcode', 'price'].includes(k) && !empty(v),
      )
      .map(([k]) => k),
  )
  if (purpose === 'update' && unsupported.length)
    throw new ProductReadError('ZETTLE_PRODUCT_FIELDS_UNSUPPORTED', unsupported)
  return catalogProduct.parse({
    uuid: remote.uuid,
    name: remote.name,
    externalReference: remote.externalReference,
    vatPercentage: remote.vatPercentage,
    variants: remote.variants,
  })
}

/** Fixed schema field names only: never provider values or arbitrary exception text. */
export class ProductReadError extends Error {
  readonly fields: string[]
  constructor(
    code:
      'ZETTLE_PRODUCT_RESPONSE_INVALID' | 'ZETTLE_PRODUCT_FIELDS_UNSUPPORTED',
    fields: string[],
  ) {
    super(code)
    const known = new Set([
      'uuid',
      'name',
      'externalReference',
      'vatPercentage',
      'variants',
      'sku',
      'barcode',
      'price',
      'amount',
      'currencyId',
      'description',
      'presentation',
      'categories',
      'imageLookupKeys',
      'unitName',
      'online',
      'variantOptionDefinitions',
      'taxCode',
      'category',
      'metadata',
      'taxRates',
      'taxExempt',
      'costPrice',
      'options',
    ])
    this.fields = [
      ...new Set(fields.map((f) => (known.has(f) ? f : 'other'))),
    ].slice(0, 20)
  }
}
