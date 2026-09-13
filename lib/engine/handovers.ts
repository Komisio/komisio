import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Self drop-off (P3): a seller announces a handover, the store receives it
// as an ordinary bag receipt. Boundary validation only; SQL owns the rules.
const handoverStatus = z.enum(['open', 'received', 'cancelled'])
export const handoverKind = z.enum(['bag', 'box'])
const iso = z.iso.datetime({ offset: true })
export const myHandovers = z.object({
  enabled: z.boolean(),
  handovers: z
    .array(
      z.object({
        id: z.uuid(),
        reference: z.string().regex(/^H-\d+$/),
        kind: handoverKind,
        estimatedItems: z.number().int(),
        note: z.string(),
        status: handoverStatus,
        createdAt: iso,
        receivedAt: iso.nullable(),
        bagReference: z.string().nullable(),
      }),
    )
    .max(50),
})
export type MyHandovers = z.infer<typeof myHandovers>
export const handoverQueueRow = z.object({
  id: z.uuid(),
  reference: z.string().regex(/^H-\d+$/),
  sellerId: z.uuid(),
  sellerName: z.string(),
  kind: handoverKind,
  estimatedItems: z.number().int(),
  note: z.string(),
  status: handoverStatus,
  createdAt: iso,
  receivedAt: iso.nullable(),
  bagId: z.uuid().nullable(),
})
export type HandoverQueueRow = z.infer<typeof handoverQueueRow>

/** Seller-side commands, under the seller's own identity. */
export const sellerHandoverCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('createHandover'),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    requestId: z.uuid(),
    kind: handoverKind,
    estimatedItems: z.number().int().min(0).max(500),
    note: z.string().trim().max(500),
  }),
  z.strictObject({
    action: z.literal('cancelHandover'),
    tenantId: z.uuid(),
    sellerId: z.uuid(),
    requestId: z.uuid(),
    handoverId: z.uuid(),
  }),
])
/** Staff command: receive a handover as a bag receipt. */
export const receiveHandoverCommand = z.strictObject({
  action: z.literal('receiveHandover'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  handoverId: z.uuid(),
  source: z.enum(['staff_receipt', 'locker']),
  note: z.string().trim().max(500),
})

export async function readMyHandovers(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const r = await client.rpc('my_handovers', {
    p_tenant: z.uuid().parse(tenant),
    p_seller: z.uuid().parse(seller),
  })
  if (r.error) throw new Error('Unable to read handovers')
  return myHandovers.parse(r.data)
}

export async function readHandoverQueue(
  client: SupabaseClient,
  tenant: string,
) {
  const r = await client.rpc('handover_queue', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (r.error) throw new Error('Unable to read the handover queue')
  return z.array(handoverQueueRow).max(100).parse(r.data)
}

export async function executeSellerHandover(
  client: SupabaseClient,
  input: unknown,
) {
  const c = sellerHandoverCommand.parse(input)
  return c.action === 'createHandover'
    ? client.rpc('create_my_handover', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
        p_kind: c.kind,
        p_estimated_items: c.estimatedItems,
        p_note: c.note,
      })
    : client.rpc('cancel_my_handover', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_handover: c.handoverId,
      })
}
