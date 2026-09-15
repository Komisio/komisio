import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from '../../mcp/config'
import {
  findReceiptsInput,
  findReceiptsTool,
  readReceiptTool,
} from '../../mcp/sales'
import { readSale, readSales } from '../../lib/engine/sales'
vi.mock('../../mcp/identity', () => ({ requireMCPIdentity: vi.fn() }))
vi.mock('../../lib/engine/sales', async (original) => ({
  ...(await original<typeof import('../../lib/engine/sales')>()),
  readSale: vi.fn(),
  readSales: vi.fn(),
}))
const id = '98000000-0000-4000-8000-000000000001'
const client = {} as unknown as SupabaseClient
const config = { tenantId: id } as MCPConfig
const sale = {
  id,
  provider: 'zettle' as const,
  external_id: 'abc-1',
  currency: 'SEK' as const,
  occurred_at: '2026-09-14T10:00:00+00:00',
  total_ore: 20000,
  status: 'completed' as const,
  recorded_at: '2026-09-14T10:01:00+00:00',
}
const line = {
  id,
  sale_id: id,
  item_id: id,
  line_no: 1,
  price_ore: 20000,
  ownership: 'consignment' as const,
  commission_basis: 'inclusive' as const,
  commission_rate_percent: '60',
  commission_ore: 12000,
  commission_vat_ore: 0,
  seller_credit_ore: 8000,
  vat_mode: 'consignment_margin' as const,
  vat_rate_bp: 2500,
  vat_ore: 2400,
}

it('rejects unknown providers, statuses, blank external ids and limits above 50', () => {
  for (const input of [
    { provider: 'square' },
    { status: 'open' },
    { externalId: ' ' },
    { limit: 51 },
    { sellerId: id },
  ])
    expect(
      findReceiptsInput.safeParse(input).success,
      JSON.stringify(input),
    ).toBe(false)
  expect(findReceiptsInput.parse({ externalId: ' abc-1 ' }).externalId).toBe(
    'abc-1',
  )
})
it('passes the filter to the engine and marks a full page as possibly truncated', async () => {
  vi.mocked(readSales).mockResolvedValue([sale])
  const r = await findReceiptsTool(client, config, {
    provider: 'zettle',
    limit: 1,
  })
  expect(vi.mocked(readSales).mock.calls[0][2]).toEqual({
    provider: 'zettle',
    limit: 1,
  })
  expect(r.potentiallyTruncated).toBe(true)
  expect(r.receipts[0]).toEqual({
    id,
    provider: 'zettle',
    externalId: 'abc-1',
    currency: 'SEK',
    occurredAt: sale.occurred_at,
    totalOre: 20000,
    status: 'completed',
    recordedAt: sale.recorded_at,
  })
  vi.mocked(readSales).mockResolvedValue([{ ...sale, total_ore: 0.5 }])
  await expect(findReceiptsTool(client, config, {})).rejects.toThrow()
})
it('returns the frozen lines with the rate as a number and fails closed on an unknown sale', async () => {
  vi.mocked(readSale).mockResolvedValue({ sale, lines: [line] })
  const r = await readReceiptTool(client, config, { saleId: id })
  expect(r.lines[0].commissionRatePercent).toBe(60)
  expect(r.lines[0].sellerCreditOre).toBe(8000)
  expect(r.receipt.totalOre).toBe(20000)
  vi.mocked(readSale).mockResolvedValue(null)
  await expect(readReceiptTool(client, config, { saleId: id })).rejects.toThrow(
    'NOT_FOUND',
  )
})
