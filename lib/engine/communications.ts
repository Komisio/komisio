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
    welcome: z.literal(true).optional(),
  })
  .refine(
    (v) => (v.kind === 'message') === (v.referenceId === null),
    'A free message carries no reference; every other kind needs one',
  )
  .refine(
    (v) => !v.welcome || (v.kind === 'message' && v.freeText === ''),
    'Welcome messages use the fixed template',
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
export async function readSellerWelcome(
  client: SupabaseClient,
  tenant: string,
  seller: string,
) {
  const { data, error } = await client
    .from('seller_communications')
    .select('status')
    .eq('tenant_id', z.uuid().parse(tenant))
    .eq('seller_id', z.uuid().parse(seller))
    .eq('template_key', 'seller.welcome')
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Unable to read welcome delivery')
  return data ? communicationStatus.parse(data.status) : null
}
const columns =
  'id,kind,locale,recipient,subject,body,reference_kind,reference_id,status,queued_at,delivered_at'

/** Newest 50 messages for one seller. RLS scopes the read. */
export async function readSellerCommunications(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const { data, error } = await client
    .from('seller_communications')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('seller_id', z.uuid().parse(sellerInput))
    .order('queued_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read communications')
  return z.array(row).parse(data)
}

/** Staff history, retaining the existing tenant/seller RLS scope and stable order. */
export async function readSellerCommunicationHistory(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
  pageInput = 0,
) {
  const tenant = z.uuid().parse(tenantInput)
  const seller = z.uuid().parse(sellerInput)
  const page = z.number().int().min(0).max(1000000).parse(pageInput)
  const limit = 25
  const { data, error, count } = await client
    .from('seller_communications')
    .select(columns, { count: 'exact' })
    .eq('tenant_id', tenant)
    .eq('seller_id', seller)
    .order('queued_at', { ascending: false })
    .order('id')
    .range(page * limit, page * limit + limit - 1)
  // PostgREST returns an invalid-range response for a bookmarked page beyond
  // the current count. Re-read only that scoped count; other failures stay errors.
  if (error?.code === 'PGRST103' && page > 0) {
    const current = await client
      .from('seller_communications')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenant)
      .eq('seller_id', seller)
    if (current.error) throw new Error('Unable to read communication history')
    const total = z.number().int().nonnegative().parse(current.count)
    if (total > page * limit)
      throw new Error('Unable to read communication history')
    return {
      items: [] as SellerCommunication[],
      total,
      page,
      limit,
    }
  }
  if (error) throw new Error('Unable to read communication history')
  return {
    items: z.array(row).max(limit).parse(data),
    total: z.number().int().nonnegative().parse(count),
    page,
    limit,
  }
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
