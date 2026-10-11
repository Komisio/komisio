import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const purchaseReceipt = z.object({
  id: z.uuid(),
  reference: z.union([z.number().int(), z.string()]),
  supplier_note: z.string(),
  purchase_price_ore: z.union([z.number().int(), z.string()]),
  evidence_reference: z.string(),
  margin_eligible: z.boolean(),
  purchased_at: z.iso.datetime({ offset: true }),
})

/** Exact immutable purchase evidence within the active tenant and existing RLS. */
export async function readPurchaseReceipt(
  client: SupabaseClient,
  tenantInput: string,
  receiptInput: string,
) {
  const { data, error } = await client
    .from('purchase_receipts')
    .select(
      'id,reference,supplier_note,purchase_price_ore,evidence_reference,margin_eligible,purchased_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('id', z.uuid().parse(receiptInput))
    .maybeSingle()
  if (error) throw new Error('Unable to read purchase receipt')
  return data ? purchaseReceipt.parse(data) : null
}
