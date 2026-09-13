import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Seller data export (pilot gate): every row Komisio holds about one seller,
// assembled in SQL for the owner or an admin and logged as an access event.
// The shape is the database's own rows; the boundary only checks the envelope.
const exportEnvelope = z
  .object({
    exportedAt: z.iso.datetime({ offset: true }),
    exportedBy: z.uuid(),
    tenantId: z.uuid(),
    seller: z.object({ id: z.uuid(), name: z.string() }).passthrough(),
  })
  .passthrough()
export type SellerDataExport = z.infer<typeof exportEnvelope>

/** Owner or admin only; SQL logs the export and refuses other roles. */
export async function readSellerDataExport(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const result = await client.rpc('seller_data_export', {
    p_tenant: z.uuid().parse(tenantInput),
    p_seller: z.uuid().parse(sellerInput),
  })
  if (result.error) {
    if (result.error.message.includes('SELLER_NOT_FOUND'))
      throw new Error('SELLER_NOT_FOUND')
    throw new Error('FORBIDDEN')
  }
  return exportEnvelope.parse(result.data)
}
