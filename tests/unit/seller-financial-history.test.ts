import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readMySellerPayoutsPage,
  readMySellerStatementsPage,
  sellerPayoutsPage,
  sellerStatementsPage,
} from '../../lib/engine/seller-financial-history'
const tenant = '97000000-0000-4000-8000-000000000001',
  seller = '97000000-0000-4000-8000-000000000002',
  id = '97000000-0000-4000-8000-000000000003'
const base = {
  tenantId: tenant,
  sellerId: seller,
  currency: 'SEK',
  total: 105,
  offset: 100,
  limit: 25,
}
const payout = {
  id,
  amount_ore: 10000,
  status: 'paid',
  request_source: 'staff',
  requested_at: '2026-10-28T20:00:00+00:00',
}
const payouts = () => ({
  ...base,
  balance: {
    sellerId: seller,
    availableOre: -300,
    reservedOre: 5000,
    creditedOre: 50000,
    paidOre: 45300,
    entries: 20,
  },
  thresholdOre: 10000,
  payouts: [payout],
})
const statement = {
  id,
  number: 72,
  kind: 'credit_note',
  corrects_id: seller,
  period_from: '2026-10-01T00:00:00Z',
  period_to: '2026-10-28T00:00:00Z',
  issued_at: '2026-10-28T20:00:00Z',
  opening_ore: -100,
  closing_ore: 2345,
  is_self_billing: true,
}
it('preserves signed recorded facts, actual payout status and self-billing correction markers', () => {
  expect(sellerPayoutsPage.parse(payouts())).toEqual(payouts())
  const data = { ...base, statements: [statement] }
  expect(sellerStatementsPage.parse(data)).toEqual(data)
})
it('rejects oversized or malformed money, dates, statuses, duplicates and foreign balance identities', () => {
  for (const row of [
    { ...payout, amount_ore: 1.5 },
    { ...payout, amount_ore: Number.MAX_SAFE_INTEGER + 1 },
    { ...payout, status: 'unknown' },
    { ...payout, requested_at: 'yesterday' },
  ])
    expect(
      sellerPayoutsPage.safeParse({ ...payouts(), payouts: [row] }).success,
    ).toBe(false)
  expect(
    sellerPayoutsPage.safeParse({ ...payouts(), payouts: [payout, payout] })
      .success,
  ).toBe(false)
  expect(
    sellerPayoutsPage.safeParse({
      ...payouts(),
      balance: { ...payouts().balance, sellerId: tenant },
    }).success,
  ).toBe(false)
  expect(
    sellerPayoutsPage.safeParse({
      ...payouts(),
      payouts: Array(26).fill(payout),
    }).success,
  ).toBe(false)
  expect(
    sellerStatementsPage.safeParse({
      ...base,
      statements: [statement, statement],
    }).success,
  ).toBe(false)
  expect(
    sellerStatementsPage.safeParse({
      ...base,
      statements: [{ ...statement, closing_ore: 0.1 }],
    }).success,
  ).toBe(false)
})
it('validates scope and bounded offset before the RPC', async () => {
  const rpc = vi.fn(),
    client = { rpc } as unknown as SupabaseClient
  for (const read of [readMySellerPayoutsPage, readMySellerStatementsPage]) {
    for (const offset of [-1, 0.1, NaN, 2500001])
      await expect(read(client, tenant, seller, offset)).rejects.toThrow()
    await expect(read(client, 'invalid', seller)).rejects.toThrow()
  }
  expect(rpc).not.toHaveBeenCalled()
})
it('passes exact identity/page and refuses mismatched responses or denied/missing contracts', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: payouts(), error: null }),
    client = { rpc } as unknown as SupabaseClient
  expect(await readMySellerPayoutsPage(client, tenant, seller, 100)).toEqual(
    payouts(),
  )
  expect(rpc).toHaveBeenCalledWith('my_seller_payouts_page', {
    p_tenant: tenant,
    p_seller: seller,
    p_offset: 100,
  })
  for (const patch of [
    { tenantId: seller },
    { sellerId: tenant },
    { offset: 0 },
  ]) {
    rpc.mockResolvedValue({ data: { ...payouts(), ...patch }, error: null })
    await expect(
      readMySellerPayoutsPage(client, tenant, seller, 100),
    ).rejects.toThrow()
  }
  for (const code of ['42501', 'PGRST202', '57014']) {
    rpc.mockResolvedValue({ error: { code } })
    await expect(
      readMySellerStatementsPage(client, tenant, seller),
    ).rejects.toThrow('Unable to read seller history')
  }
})
it('preserves past-end total without fabricating rows', async () => {
  const data = { ...base, offset: 200, statements: [] }
  const rpc = vi.fn().mockResolvedValue({ data, error: null }),
    client = { rpc } as unknown as SupabaseClient
  expect(await readMySellerStatementsPage(client, tenant, seller, 200)).toEqual(
    data,
  )
  expect(rpc).toHaveBeenCalledWith('my_seller_statements_page', {
    p_tenant: tenant,
    p_seller: seller,
    p_offset: 200,
  })
  expect(
    sellerStatementsPage.safeParse({ ...data, statements: [statement] })
      .success,
  ).toBe(false)
})
