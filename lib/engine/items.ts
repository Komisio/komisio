import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Commercial acceptance (P1 S4): one command, three origins. SQL checks the
// origin is current, custody exists, the agreement prerequisite and the seller
// review mode, then freezes terms. This module only validates the boundary.
export const originKind = z.enum([
  'inspection_draft',
  'reception_review',
  'purchase',
])
export type OriginKind = z.infer<typeof originKind>

export const acceptItemCommand = z
  .strictObject({
    action: z.literal('acceptItem'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    originKind,
    originId: z.uuid(),
    originRevision: z.number().int().min(1).max(2147483646).nullable(),
    // Exact decimal text at the boundary; öre in the database, never float.
    price: z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/),
  })
  .refine(
    (v) => (v.originKind === 'purchase') === (v.originRevision === null),
    'Purchase origins carry no revision; the others require one',
  )

const frozenTerms = z
  .object({
    ownership: z.enum(['consignment', 'store']),
    commissionBasis: z.enum(['inclusive', 'exclusive']).optional(),
    commissionRatePercent: z.number().optional(),
    sellerTermsVersion: z.number().int().optional(),
    salePeriodDays: z.number().int(),
    endOfPeriodAction: z.enum(['charity', 'return']),
    markdownSteps: z.array(
      z.object({ afterDays: z.number(), percent: z.number() }),
    ),
    storePolicyVersion: z.number().int(),
    agreementVersionId: z.uuid().nullable(),
    evidenceKind: z.enum(['staff_recorded', 'seller_response', 'none']),
    purchasePriceOre: z.number().int().optional(),
    marginEligible: z.boolean().optional(),
    origin: z.record(z.string(), z.unknown()),
  })
  .loose()
const itemRow = z.object({
  id: z.uuid(),
  origin_kind: originKind,
  origin_id: z.uuid(),
  origin_revision: z.number().int().nullable(),
  custody_kind: z.enum(['bag', 'garment']).nullable(),
  custody_id: z.uuid().nullable(),
  seller_id: z.uuid().nullable(),
  ownership: z.enum(['consignment', 'store']),
  terms: frozenTerms,
  accepted_at: z.iso.datetime({ offset: true }),
})
export type ItemRow = z.infer<typeof itemRow>
const priceRow = z.object({
  id: z.uuid(),
  price_ore: z.union([z.number().int(), z.string()]),
  reason: z.string(),
  set_at: z.iso.datetime({ offset: true }),
})
const eventRow = z.object({
  id: z.uuid(),
  kind: z.string(),
  detail: z.record(z.string(), z.unknown()),
  occurred_at: z.iso.datetime({ offset: true }),
})
const columns =
  'id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_at'

/** The item accepted from one origin, or null. RLS scopes the read. */
export async function readItemForOrigin(
  client: SupabaseClient,
  tenantInput: string,
  kind: OriginKind,
  originInput: string,
) {
  const { data, error } = await client
    .from('items')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('origin_kind', originKind.parse(kind))
    .eq('origin_id', z.uuid().parse(originInput))
    .maybeSingle()
  if (error) throw new Error('Unable to read item')
  return data ? itemRow.parse(data) : null
}

/** Items for many origins of one kind, keyed by origin id. */
export async function readItemsForOrigins(
  client: SupabaseClient,
  tenantInput: string,
  kind: OriginKind,
  originIds: string[],
) {
  const ids = z.array(z.uuid()).max(50).parse(originIds)
  if (!ids.length) return new Map<string, ItemRow>()
  const { data, error } = await client
    .from('items')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('origin_kind', originKind.parse(kind))
    .in('origin_id', ids)
  if (error) throw new Error('Unable to read items')
  return new Map(
    z
      .array(itemRow)
      .parse(data)
      .map((r) => [r.origin_id, r]),
  )
}

/** Newest 50 items with their current price. */
export async function readItems(client: SupabaseClient, tenantInput: string) {
  const tenantId = z.uuid().parse(tenantInput)
  const { data, error } = await client
    .from('items')
    .select(columns)
    .eq('tenant_id', tenantId)
    .order('accepted_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read items')
  const items = z.array(itemRow).parse(data)
  if (!items.length) return []
  const prices = await client
    .from('item_prices')
    .select('id,item_id,price_ore,reason,set_at')
    .eq('tenant_id', tenantId)
    .in(
      'item_id',
      items.map((i) => i.id),
    )
    .order('set_at', { ascending: false })
    .order('seq', { ascending: false })
  if (prices.error) throw new Error('Unable to read item prices')
  const current = new Map<string, number>()
  for (const p of z
    .array(priceRow.extend({ item_id: z.uuid() }))
    .parse(prices.data))
    if (!current.has(p.item_id)) current.set(p.item_id, Number(p.price_ore))
  return items.map((i) => ({ ...i, priceOre: current.get(i.id) ?? null }))
}

/** One item with its price series and event stream. */
export async function readItem(
  client: SupabaseClient,
  tenantInput: string,
  itemInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    itemId = z.uuid().parse(itemInput)
  const item = await client
    .from('items')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('id', itemId)
    .maybeSingle()
  if (item.error) throw new Error('Unable to read item')
  if (!item.data) return null
  const [prices, events] = await Promise.all([
    client
      .from('item_prices')
      .select('id,price_ore,reason,set_at')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .order('set_at', { ascending: false })
      .order('seq', { ascending: false }),
    client
      .from('item_events')
      .select('id,kind,detail,occurred_at')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .order('occurred_at'),
  ])
  if (prices.error || events.error) throw new Error('Unable to read item')
  return {
    item: itemRow.parse(item.data),
    prices: z
      .array(priceRow)
      .parse(prices.data)
      .map((p) => ({ ...p, price_ore: Number(p.price_ore) })),
    events: z.array(eventRow).parse(events.data),
  }
}

// Items overview: every accepted item with the title and category its origin
// holds, the derived lifecycle stage, the current price and when it sold.
// One read for the items page and the agent's "find items". Any member.
export const itemStage = z.enum([
  'on_sale',
  'markdown_due',
  'period_ending',
  'period_ended',
  'ended',
  'sold',
])
export type ItemStage = z.infer<typeof itemStage>
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export const itemsOverview = z.object({
  currency: z.string(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        originKind: originKind,
        originId: z.uuid(),
        sellerId: z.uuid().nullable(),
        ownership: z.enum(['consignment', 'store']),
        acceptedAt: z.string(),
        title: z.string().nullable(),
        category: z.string().nullable(),
        stage: itemStage,
        periodEnd: z.string(),
        currentPriceOre: ore.nullable(),
        soldAt: z.string().nullable(),
      }),
    )
    .max(100),
  total: z.number().int(),
  limit: z.number().int(),
  query: z.string().nullable(),
  stage: itemStage.nullable(),
})
export type ItemsOverview = z.infer<typeof itemsOverview>

/** Newest items first, filtered by text in title or category and by stage. Null until the migration reaches the database. */
export async function readItemsOverview(
  client: SupabaseClient,
  tenantInput: string,
  filter: { query?: string; stage?: string; limit?: number } = {},
) {
  const r = await client.rpc('items_overview', {
    p_tenant: z.uuid().parse(tenantInput),
    p_query: (filter.query ?? '').trim().slice(0, 120),
    p_stage: filter.stage ? itemStage.parse(filter.stage) : null,
    p_limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(filter.limit ?? 50),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return itemsOverview.parse(r.data)
}

export function formatOre(value: number | string) {
  const ore = BigInt(value)
  const kronor = ore / 100n,
    rest = ore % 100n
  return `${kronor}.${rest.toString().padStart(2, '0')}`
}
