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

export const purchaseSort = z.enum([
  'reference',
  'note',
  'date',
  'cost',
  'price',
  'status',
])
export const purchaseStatus = z.enum(['all', 'pending', 'registered'])
export type PurchaseSort = z.infer<typeof purchaseSort>

export async function readPurchasePage(
  client: SupabaseClient,
  tenant: string,
  options: {
    query: string
    status: z.infer<typeof purchaseStatus>
    sort: PurchaseSort
    direction: 'asc' | 'desc'
    offset: number
    limit: number
  },
) {
  const { data, error } = await client.rpc('purchase_search_page', {
    p_tenant: z.uuid().parse(tenant),
    p_query: z.string().max(120).parse(options.query),
    p_status: purchaseStatus.parse(options.status),
    p_sort: purchaseSort.parse(options.sort),
    p_direction: z.enum(['asc', 'desc']).parse(options.direction),
    p_limit: z.number().int().min(1).max(100).parse(options.limit),
    p_offset: z.number().int().min(0).max(200000000).parse(options.offset),
  })
  if (error) throw new Error('Unable to load purchases')
  return z
    .object({
      total: z.number().int().nonnegative(),
      rows: z
        .array(
          purchaseReceipt.extend({
            item_id: z.uuid().nullable(),
            sale_price_ore: z.union([z.number().int(), z.string()]).nullable(),
          }),
        )
        .max(options.limit),
    })
    .parse(data)
}

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
