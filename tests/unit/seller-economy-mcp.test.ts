import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from '../../mcp/config'
import { readSellerEconomyTool } from '../../mcp/seller-economy'
import {
  readSellerBalance,
  readSellerLedger,
} from '../../lib/engine/seller-ledger'
vi.mock('../../mcp/identity', () => ({ requireMCPIdentity: vi.fn() }))
vi.mock('../../lib/engine/seller-ledger', () => ({
  readSellerBalance: vi.fn(),
  readSellerLedger: vi.fn(),
}))
const id = '96000000-0000-4000-8000-000000000001'
const client = {
  rpc: async () => ({ data: 'SEK', error: null }),
} as unknown as SupabaseClient
const config = { tenantId: id } as MCPConfig
const balance = {
  sellerId: id,
  availableOre: 100,
  reservedOre: 0,
  creditedOre: 100,
  paidOre: 0,
  entries: 1,
}
it('fails closed on totals that cannot be represented exactly at the tool boundary', async () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 0.5]) {
    vi.mocked(readSellerBalance).mockResolvedValue({
      ...balance,
      availableOre: value,
    })
    await expect(
      readSellerEconomyTool(client, config, { sellerId: id }),
    ).rejects.toThrow()
  }
})
it('does not return unsafe ledger amounts or private reasons', async () => {
  vi.mocked(readSellerBalance).mockResolvedValue(balance)
  const entry = {
    id,
    kind: 'adjustment' as const,
    amount_ore: 10,
    reference_kind: 'adjustment',
    reference_id: id,
    reason: 'PRIVATE',
    occurred_at: '2026-09-13T00:00:00Z',
  }
  vi.mocked(readSellerLedger).mockResolvedValue([entry])
  const result = await readSellerEconomyTool(
    client,
    config,
    { sellerId: id },
    true,
  )
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
  vi.mocked(readSellerLedger).mockResolvedValue([
    { ...entry, amount_ore: Number.MAX_SAFE_INTEGER + 1 },
  ])
  await expect(
    readSellerEconomyTool(client, config, { sellerId: id }, true),
  ).rejects.toThrow()
})
