import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from '../../mcp/config'
import {
  findItemsInput,
  findItemsTool,
  readItemSummaryTool,
} from '../../mcp/items'
import { readItem, readItemsOverview } from '../../lib/engine/items'
vi.mock('../../mcp/identity', () => ({ requireMCPIdentity: vi.fn() }))
vi.mock('../../lib/engine/items', async (original) => ({
  ...(await original<typeof import('../../lib/engine/items')>()),
  readItem: vi.fn(),
  readItemsOverview: vi.fn(),
}))
const id = '97000000-0000-4000-8000-000000000001'
const client = {} as unknown as SupabaseClient
const config = { tenantId: id } as MCPConfig
const overviewItem = {
  id,
  originKind: 'purchase' as const,
  originId: id,
  sellerId: null,
  ownership: 'store' as const,
  acceptedAt: '2026-09-14T10:00:00+00:00',
  title: 'Vintage lamp',
  category: null,
  stage: 'on_sale' as const,
  periodEnd: '2026-10-26T10:00:00+00:00',
  currentPriceOre: 25000,
  soldAt: null,
}

it('rejects unknown stages, overlong text and limits outside 1..100 at the tool boundary', () => {
  for (const input of [
    { stage: 'listed' },
    { query: 'x'.repeat(121) },
    { limit: 0 },
    { limit: 101 },
    { tenantId: id },
  ])
    expect(findItemsInput.safeParse(input).success, JSON.stringify(input)).toBe(
      false,
    )
  expect(findItemsInput.parse({})).toEqual({ query: '', limit: 50 })
})
it('marks truncation and fails closed before the migration is live', async () => {
  vi.mocked(readItemsOverview).mockResolvedValue({
    currency: 'SEK',
    items: [overviewItem],
    total: 3,
    limit: 1,
    query: null,
    stage: null,
  })
  const r = await findItemsTool(client, config, { limit: 1 })
  expect(r.potentiallyTruncated).toBe(true)
  expect(r.readOnly).toBe(true)
  expect(r.evidenceIsUntrusted).toBe(true)
  expect(r.items[0].title).toBe('Vintage lamp')
  vi.mocked(readItemsOverview).mockResolvedValue(null)
  await expect(findItemsTool(client, config, {})).rejects.toThrow(
    'NOT_AVAILABLE',
  )
})
it('fails closed on prices that cannot be represented exactly', async () => {
  vi.mocked(readItemsOverview).mockResolvedValue({
    currency: 'SEK',
    items: [{ ...overviewItem, currentPriceOre: 0.5 }],
    total: 1,
    limit: 50,
    query: null,
    stage: null,
  })
  await expect(findItemsTool(client, config, {})).rejects.toThrow()
})
it('omits free-text reasons and event details from the item summary', async () => {
  vi.mocked(readItem).mockResolvedValue({
    item: {
      id,
      origin_kind: 'purchase',
      origin_id: id,
      origin_revision: null,
      custody_kind: null,
      custody_id: null,
      seller_id: null,
      ownership: 'store',
      terms: {} as never,
      accepted_at: '2026-09-14T10:00:00+00:00',
    },
    prices: [
      {
        id,
        price_ore: 25000,
        reason: 'PRIVATE REASON',
        set_at: '2026-09-14T10:00:00+00:00',
      },
    ],
    events: [
      {
        id,
        kind: 'accepted',
        detail: { note: 'PRIVATE DETAIL' },
        occurred_at: '2026-09-14T10:00:00+00:00',
      },
    ],
  })
  const r = await readItemSummaryTool(client, config, { itemId: id })
  expect(JSON.stringify(r)).not.toContain('PRIVATE')
  expect(r.prices[0].priceOre).toBe(25000)
  expect(r.events[0].kind).toBe('accepted')
  vi.mocked(readItem).mockResolvedValue(null)
  await expect(
    readItemSummaryTool(client, config, { itemId: id }),
  ).rejects.toThrow('NOT_FOUND')
})
