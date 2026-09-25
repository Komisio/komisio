import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { communicationKind } from '../communications/templates'
import { locales } from '../i18n'

// Communication log (P2 S18). The route renders a versioned template, queues
// the exact text in SQL, sends through the transport and records the outcome.
export const sendSellerCommunicationCommand = z
  .strictObject({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sellerId: z.uuid(),
    kind: communicationKind,
    referenceId: z.uuid().nullable().default(null),
    freeText: z.string().max(1000).default(''),
  })
  .refine(
    (v) => (v.kind === 'message') === (v.referenceId === null),
    'A free message carries no reference; every other kind needs one',
  )
export const communicationStatus = z.enum([
  'queued',
  'sent',
  'restricted',
  'manual',
  'unconfirmed',
  'failed',
])
const row = z.object({
  id: z.uuid(),
  kind: communicationKind,
  locale: z.enum(locales),
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  reference_kind: z.string(),
  // Persisted PostgreSQL UUIDs may predate RFC-shaped derived identifiers.
  reference_id: z.guid().nullable(),
  status: communicationStatus,
  queued_at: z.iso.datetime({ offset: true }),
  delivered_at: z.iso.datetime({ offset: true }).nullable(),
})
export type SellerCommunication = z.infer<typeof row>

/** Newest 50 messages for one seller. RLS scopes the read. */
export async function readSellerCommunications(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const { data, error } = await client
    .from('seller_communications')
    .select(
      'id,kind,locale,recipient,subject,body,reference_kind,reference_id,status,queued_at,delivered_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('seller_id', z.uuid().parse(sellerInput))
    .order('queued_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read communications')
  return z.array(row).parse(data)
}

export const referenceKindFor: Record<
  z.infer<typeof communicationKind>,
  'item' | 'sale_line' | 'payout' | 'statement' | 'none'
> = {
  item_accepted: 'item',
  item_sold: 'sale_line',
  payout_approved: 'payout',
  payout_paid: 'payout',
  statement_issued: 'statement',
  message: 'none',
}
