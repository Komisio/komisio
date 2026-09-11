import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const intakeCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('registerSeller'),
      tenantId: z.uuid(),
      requestId: z.uuid(),
      name: z.string().trim().min(1).max(120),
      email: z.union([z.literal(''), z.email().max(254)]),
      phone: z.string().trim().max(40),
    })
    .refine((v) => v.email !== '' || v.phone !== ''),
  z.object({
    action: z.literal('receiveBag'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sellerId: z.uuid(),
    note: z.string().trim().max(500),
  }),
])

// All callers use the authenticated client; SQL independently authorizes the actor.
export async function executeIntake(client: SupabaseClient, input: unknown) {
  const c = intakeCommand.parse(input)
  return c.action === 'registerSeller'
    ? client.rpc('register_seller', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_name: c.name,
        p_email: c.email,
        p_phone: c.phone,
      })
    : client.rpc('receive_bag', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
        p_note: c.note,
      })
}

export type Seller = { id: string; name: string; email: string; phone: string }
export type BagReceipt = {
  id: string
  seller_id: string
  reference: number
  note: string
  received_at: string
}
