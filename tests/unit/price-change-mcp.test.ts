import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from '../../mcp/config'
import {
  proposePriceChangeInput,
  proposePriceChangeTool,
} from '../../mcp/price-change'
import { readItem } from '../../lib/engine/items'
import { readPriceEvidence } from '../../lib/engine/price-evidence'
import { proposeOperation } from '../../lib/engine/operations'
vi.mock('../../mcp/identity', () => ({ requireMCPIdentity: vi.fn() }))
vi.mock('../../lib/engine/items', async (original) => ({
  ...(await original<typeof import('../../lib/engine/items')>()),
  readItem: vi.fn(),
}))
vi.mock('../../lib/engine/price-evidence', async (original) => ({
  ...(await original<typeof import('../../lib/engine/price-evidence')>()),
  readPriceEvidence: vi.fn(),
}))
vi.mock('../../lib/engine/operations', async (original) => ({
  ...(await original<typeof import('../../lib/engine/operations')>()),
  proposeOperation: vi.fn(),
}))
const id = '99000000-0000-4000-8000-000000000001'
const client = {} as unknown as SupabaseClient
const config = { tenantId: id } as MCPConfig
const base = {
  requestId: id,
  expiresAt: '2026-09-16T00:00:00Z',
  itemId: id,
  priceOre: 25000,
  reason: 'Comparable jackets sold around this price',
  evidence: {
    category: 'Jackets',
    query: '',
    days: 365,
    count: 4,
    medianSoldOre: 24000,
  },
}
const fresh = {
  currency: 'SEK',
  days: 365,
  category: 'Jackets',
  query: null,
  summary: {
    count: 4,
    medianSoldOre: 24000,
    minSoldOre: 20000,
    maxSoldOre: 30000,
    averageDaysToSale: 12,
  },
  matches: [],
}
const item = {
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
      price_ore: 30000,
      reason: 'accepted',
      set_at: '2026-09-14T10:00:00+00:00',
    },
  ],
  events: [],
}

it('requires a cited evidence read with count and median', () => {
  for (const patch of [
    { evidence: { category: 'Jackets' } },
    { evidence: { ...base.evidence, count: -1 } },
    { priceOre: 0.5 },
    { reason: '' },
    { tenantId: id },
  ])
    expect(
      proposePriceChangeInput.safeParse({ ...base, ...patch }).success,
      JSON.stringify(patch),
    ).toBe(false)
})
it('stages one setPrice at medium risk with the citation in the reason', async () => {
  vi.mocked(readItem).mockResolvedValue(item as never)
  vi.mocked(readPriceEvidence).mockResolvedValue(fresh as never)
  vi.mocked(proposeOperation).mockResolvedValue({
    data: null,
    error: null,
  } as never)
  const r = await proposePriceChangeTool(client, config, base)
  expect(r).toMatchObject({
    staged: true,
    executed: false,
    riskLevel: 'medium',
    requiresDifferentApprover: true,
    currentPriceOre: 30000,
    proposedPriceOre: 25000,
    isNotAPrice: true,
  })
  const call = vi.mocked(proposeOperation).mock.calls[0][1] as {
    kind: string
    payload: { action: string; reason: string; items: unknown[] }
  }
  expect(call.kind).toBe('bulkItemUpdate')
  expect(call.payload).toMatchObject({
    action: 'setPrice',
    items: [{ itemId: id, priceOre: 25000 }],
  })
  expect((call.payload as { reason: string }).reason).toContain(
    'sold=4 median=24000 ore',
  )
  expect(vi.mocked(readPriceEvidence).mock.calls[0][2]).toEqual({
    category: 'Jackets',
    query: '',
    days: 365,
  })
})
it('refuses a stale citation and an unknown item without staging', async () => {
  vi.mocked(proposeOperation).mockClear()
  vi.mocked(readItem).mockResolvedValue(item as never)
  vi.mocked(readPriceEvidence).mockResolvedValue({
    ...fresh,
    summary: { ...fresh.summary, count: 5 },
  } as never)
  await expect(proposePriceChangeTool(client, config, base)).rejects.toThrow(
    'EVIDENCE_STALE',
  )
  vi.mocked(readPriceEvidence).mockResolvedValue(fresh as never)
  vi.mocked(readItem).mockResolvedValue(null)
  await expect(proposePriceChangeTool(client, config, base)).rejects.toThrow(
    'NOT_FOUND',
  )
  expect(vi.mocked(proposeOperation)).not.toHaveBeenCalled()
})
