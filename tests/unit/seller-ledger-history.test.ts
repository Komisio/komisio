import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellerLedgerHistory } from '../../lib/engine/seller-ledger'

const tenant = '11111111-1111-4111-8111-111111111111'
const seller = '22222222-2222-4222-8222-222222222222'
const entry = {
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'adjustment',
  amount_ore: '-123',
  reference_kind: 'adjustment',
  reference_id: '00000000-0000-0000-0000-000000000001',
  reason: 'Synthetic correction',
  occurred_at: '2026-09-29T12:00:00Z',
}

it('preserves exact entries and the server-clamped page with scoped arguments', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { items: [entry], total: 51, page: 1, limit: 50 },
    error: null,
  })
  const result = await readSellerLedgerHistory(
    { rpc } as unknown as SupabaseClient,
    tenant,
    seller,
    99,
  )
  expect(rpc).toHaveBeenCalledExactlyOnceWith('seller_ledger_history_page', {
    p_tenant: tenant,
    p_seller: seller,
    p_page: 99,
  })
  expect(result).toMatchObject({ total: 51, page: 1, limit: 50, legacy: false })
  expect(result.items).toEqual([{ ...entry, amount_ore: -123 }])
})

it('marks the newest-only fallback explicitly and does not invent a total', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: [entry], error: null })
  const result = await readSellerLedgerHistory(
    { rpc } as unknown as SupabaseClient,
    tenant,
    seller,
    1,
  )
  expect(rpc).toHaveBeenNthCalledWith(2, 'seller_ledger_page', {
    p_tenant: tenant,
    p_seller: seller,
  })
  expect(result).toMatchObject({ total: null, page: 0, legacy: true })
  expect(result.items).toEqual([{ ...entry, amount_ore: -123 }])
})

it('never downgrades denied or failed reads to the legacy contract', async () => {
  for (const code of ['42501', '57014']) {
    const rpc = vi.fn().mockResolvedValue({ error: { code } })
    await expect(
      readSellerLedgerHistory(
        { rpc } as unknown as SupabaseClient,
        tenant,
        seller,
      ),
    ).rejects.toThrow('Unable to read seller ledger history')
    expect(rpc).toHaveBeenCalledTimes(1)
  }
})

it('rejects invalid paging before issuing a read', async () => {
  const rpc = vi.fn()
  for (const page of [-1, 0.5, 1000001])
    await expect(
      readSellerLedgerHistory(
        { rpc } as unknown as SupabaseClient,
        tenant,
        seller,
        page,
      ),
    ).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
