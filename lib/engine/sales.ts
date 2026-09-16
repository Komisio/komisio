import { z } from 'zod'
import { currencyCode } from './money'
import type { SupabaseClient } from '@supabase/supabase-js'

// Sales (P2 S11): a fact from a POS or the counter, idempotent by provider and
// external id, with commission, seller credit and VAT frozen per line in SQL.
export const saleProvider = z.enum(['manual', 'zettle', 'shopify'])
const price = z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/)
export const saleLineInput = z.strictObject({ itemId: z.guid(), price })
export const recordSaleCommand = z
  .strictObject({
    action: z.literal('recordSale'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    provider: saleProvider,
    externalId: z.string().trim().min(1).max(200),
    occurredAt: z.iso.datetime({ offset: true }),
    currency: currencyCode,
    lines: z.array(saleLineInput).min(1).max(50),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.itemId)).size === v.lines.length,
    'One line per item',
  )

const ore = z.union([z.number().int(), z.string()]).transform(Number)
const lineRow = z.object({
  id: z.uuid(),
  sale_id: z.uuid(),
  item_id: z.guid(),
  line_no: z.number().int(),
  price_ore: ore,
  ownership: z.enum(['consignment', 'store']),
  commission_basis: z.enum(['inclusive', 'exclusive']).nullable(),
  commission_rate_percent: z.union([z.number(), z.string()]).nullable(),
  commission_ore: ore,
  commission_vat_ore: ore,
  seller_credit_ore: ore,
  vat_mode: z.enum([
    'consignment_margin',
    'consignment_full',
    'consignment_business',
    'store_margin',
    'store_full',
  ]),
  vat_rate_bp: z.number().int(),
  vat_ore: ore,
})
const saleRow = z.object({
  id: z.uuid(),
  provider: saleProvider,
  external_id: z.string(),
  currency: currencyCode,
  occurred_at: z.iso.datetime({ offset: true }),
  total_ore: ore,
  status: z.enum(['completed', 'reversed']),
  recorded_at: z.iso.datetime({ offset: true }),
})
export type SaleRow = z.infer<typeof saleRow>
export type SaleLineRow = z.infer<typeof lineRow>
const saleColumns =
  'id,provider,external_id,currency,occurred_at,total_ore,status,recorded_at'
const lineColumns =
  'id,sale_id,item_id,line_no,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore,vat_mode,vat_rate_bp,vat_ore'

export const salesFilter = z.strictObject({
  provider: saleProvider.optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['completed', 'reversed']).optional(),
  limit: z.number().int().min(1).max(50).default(50),
})
export type SalesFilter = z.input<typeof salesFilter>

/** Newest sales, at most 50, optionally by provider, exact external id or status. RLS scopes the read. */
export async function readSales(
  client: SupabaseClient,
  tenantInput: string,
  filterInput: SalesFilter = {},
) {
  const filter = salesFilter.parse(filterInput)
  const r = await client.rpc('sales_page', {
    p_tenant: z.uuid().parse(tenantInput),
    p_provider: filter.provider ?? null,
    p_external_id: filter.externalId ?? null,
    p_status: filter.status ?? null,
    p_limit: filter.limit,
  })
  if (r.error) throw new Error('Unable to read sales')
  return z.array(saleRow).parse(r.data)
}

/** One sale with the lines exactly as they were frozen. */
export async function readSale(
  client: SupabaseClient,
  tenantInput: string,
  saleInput: string,
) {
  const r = await client.rpc('sale_detail', {
    p_tenant: z.uuid().parse(tenantInput),
    p_sale: z.guid().parse(saleInput),
  })
  if (r.error) throw new Error('Unable to read sale')
  if (r.data === null) return null
  return z.object({ sale: saleRow, lines: z.array(lineRow) }).parse(r.data)
}

/** Item ids that already sit on a completed sale. */
export async function readSoldItemIds(
  client: SupabaseClient,
  tenantInput: string,
  itemIds: string[],
) {
  const ids = z.array(z.uuid()).max(50).parse(itemIds)
  if (!ids.length) return new Set<string>()
  const tenantId = z.uuid().parse(tenantInput)
  const lines = await client
    .from('sale_lines')
    .select('item_id,sale_id')
    .eq('tenant_id', tenantId)
    .in('item_id', ids)
  if (lines.error) throw new Error('Unable to read sold items')
  const rows = z
    .array(z.object({ item_id: z.guid(), sale_id: z.uuid() }))
    .parse(lines.data)
  if (!rows.length) return new Set<string>()
  const sales = await client
    .from('sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .in('id', [...new Set(rows.map((r) => r.sale_id))])
  if (sales.error) throw new Error('Unable to read sold items')
  const completed = new Set(
    z
      .array(z.object({ id: z.uuid() }))
      .parse(sales.data)
      .map((s) => s.id),
  )
  return new Set(
    rows.filter((r) => completed.has(r.sale_id)).map((r) => r.item_id),
  )
}

export function formatOre(value: number | string) {
  const ore = BigInt(value)
  const kronor = ore / 100n,
    rest = ore % 100n
  return `${kronor}.${rest.toString().padStart(2, '0')}`
}
