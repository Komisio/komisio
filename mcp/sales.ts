import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readSale, readSales, salesFilter } from '../lib/engine/sales'

// Receipts for the staff agent: the sale facts the POS integration recorded,
// with the frozen lines. Seller ids only, never names or contacts; no writes.
const exactOre = z.number().int()
const markers = {
  readOnly: true,
  evidenceIsUntrusted: true,
  guidanceOnly: true,
  amountUnit: 'ore',
} as const

export const findReceiptsInput = salesFilter
/** Newest sales first, at most 50, by provider, exact external id or status. */
export async function findReceiptsTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const filter = findReceiptsInput.parse(input)
  await requireMCPIdentity(client, config, 'sales:read')
  const sales = await readSales(client, config.tenantId, filter)
  return {
    ...markers,
    limit: filter.limit,
    potentiallyTruncated: sales.length === filter.limit,
    receipts: sales.map((s) => ({
      id: s.id,
      provider: s.provider,
      externalId: s.external_id,
      currency: s.currency,
      occurredAt: s.occurred_at,
      totalOre: exactOre.parse(s.total_ore),
      status: s.status,
      recordedAt: s.recorded_at,
    })),
  }
}

export const receiptInput = z.strictObject({ saleId: z.uuid() })
/** One sale with its frozen lines: price, ownership, commission, seller credit and VAT per line. */
export async function readReceiptTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const { saleId } = receiptInput.parse(input)
  await requireMCPIdentity(client, config, 'sales:read')
  const result = await readSale(client, config.tenantId, saleId)
  if (!result) throw new Error('NOT_FOUND')
  const { sale, lines } = result
  return {
    ...markers,
    receipt: {
      id: sale.id,
      provider: sale.provider,
      externalId: sale.external_id,
      currency: sale.currency,
      occurredAt: sale.occurred_at,
      totalOre: exactOre.parse(sale.total_ore),
      status: sale.status,
      recordedAt: sale.recorded_at,
    },
    lines: lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      priceOre: exactOre.parse(l.price_ore),
      ownership: l.ownership,
      commissionBasis: l.commission_basis,
      commissionRatePercent:
        l.commission_rate_percent === null
          ? null
          : Number(l.commission_rate_percent),
      commissionOre: exactOre.parse(l.commission_ore),
      commissionVatOre: exactOre.parse(l.commission_vat_ore),
      sellerCreditOre: exactOre.parse(l.seller_credit_ore),
      vatMode: l.vat_mode,
      vatRateBp: l.vat_rate_bp,
      vatOre: exactOre.parse(l.vat_ore),
    })),
  }
}
