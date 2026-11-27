import { z } from 'zod'

export const storeScopes = [
  'items:read',
  'items:write',
  'sellers:read',
  'sellers:write',
  'sales:read',
  'sales:write',
  'returns:read',
  'returns:write',
  'payouts:read',
] as const
const id = z.guid()
const amount = z.number().int().positive().max(99999999999)
const reason = z.string().trim().min(1).max(500)
const title = z.string().trim().min(1).max(1000)
const contact = {
  name: z.string().trim().min(1).max(120),
  email: z.union([z.email().max(254), z.literal('')]),
  phone: z.string().trim().max(40),
}
const time = z.iso.datetime({ offset: true })
export const storeCommands = {
  createSeller: {
    resource: 'sellers',
    method: 'post',
    path: '/sellers',
    summary: 'Register a private seller',
    schema: z
      .strictObject({
        ...contact,
        email: contact.email.optional(),
        phone: contact.phone.optional(),
      })
      .refine((v) => !!(v.email || v.phone), 'Email or phone is required'),
  },
  editSeller: {
    resource: 'sellers',
    method: 'patch',
    path: '/sellers/{id}',
    summary: 'Correct seller contact details',
    schema: z
      .strictObject({
        expectedRevision: z.number().int().nonnegative(),
        name: contact.name.optional(),
        email: contact.email.optional(),
        phone: contact.phone.optional(),
      })
      .refine(
        (v) => Object.keys(v).length > 1,
        'Supply at least one contact field',
      ),
  },
  createItem: {
    resource: 'items',
    method: 'post',
    path: '/items',
    summary: 'Register a seller’s item',
    schema: z.strictObject({
      sellerId: id,
      title,
      priceMinor: amount.max(99999999),
      bagId: id.optional(),
      categoryId: id.optional(),
    }),
  },
  editItem: {
    resource: 'items',
    method: 'patch',
    path: '/items/{id}',
    summary: 'Correct a title or change the catalogue price',
    schema: z
      .strictObject({
        title: title.optional(),
        expectedTitle: z.string().max(1000).nullable().optional(),
        priceMinor: amount.optional(),
        expectedPriceMinor: amount.optional(),
        reason,
      })
      .refine(
        (v) =>
          (v.title !== undefined || v.priceMinor !== undefined) &&
          (v.title !== undefined) === (v.expectedTitle !== undefined) &&
          (v.priceMinor !== undefined) === (v.expectedPriceMinor !== undefined),
        'Include the expected current value for each changed field',
      ),
  },
  endItem: {
    resource: 'items',
    method: 'post',
    path: '/items/{id}/end-period',
    summary: 'End an item’s sale period',
    schema: z.strictObject({
      endAction: z.enum(['return', 'charity']),
      reason,
    }),
  },
  recordSale: {
    resource: 'sales',
    method: 'post',
    path: '/sales',
    summary: 'Record a sale at the actual prices paid',
    schema: z
      .strictObject({
        externalId: z.string().trim().min(1).max(185),
        occurredAt: time,
        currency: z.enum(['SEK', 'EUR', 'NOK', 'DKK', 'USD']),
        lines: z
          .array(z.strictObject({ itemId: id, priceMinor: amount }))
          .min(1)
          .max(50),
      })
      .refine(
        (v) => new Set(v.lines.map((l) => l.itemId)).size === v.lines.length,
        'Each item must appear only once',
      ),
  },
  recordReturn: {
    resource: 'returns',
    method: 'post',
    path: '/returns',
    summary: 'Record the full refund of a sale line',
    schema: z.strictObject({
      saleLineId: id,
      refundMinor: amount,
      reason,
      occurredAt: time,
    }),
  },
} as const
export type StoreCommand = keyof typeof storeCommands
export const recordSchemas = {
  sellers: z.object({
    id,
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    revision: z.number().int(),
  }),
  sales: z.object({
    id,
    externalId: z.string(),
    provider: z.string(),
    occurredAt: z.string(),
    currency: z.string(),
    totalMinor: z.number().int(),
    status: z.string(),
    lines: z.array(z.object({ id, itemId: id, priceMinor: z.number().int() })),
  }),
  returns: z.object({
    id,
    saleLineId: id,
    itemId: id,
    refundMinor: z.number().int(),
    currency: z.string(),
    occurredAt: z.string(),
  }),
  payouts: z.object({
    id,
    sellerId: id,
    amountMinor: z.number().int(),
    currency: z.string(),
    status: z.string(),
    requestedAt: z.string(),
  }),
}
export const requestStatus = z.object({
  id,
  action: z.string(),
  status: z.enum(['open', 'expired', 'executed', 'failed', 'rejected']),
  resultId: id.nullable(),
  error: z.string().nullable(),
})
