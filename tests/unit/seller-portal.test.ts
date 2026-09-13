import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeSellerPortal,
  sellerPortalCommand,
  sellerAccounts,
  sellerStatement,
} from '../../lib/engine/seller-portal'
import { safeNext } from '../../lib/platform/validation'
const id = '11111111-1111-4111-8111-111111111111'
it('maps seller commands only to seller RPCs and refuses payment authority', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: id, error: null })
  const client = { rpc } as unknown as SupabaseClient
  await executeSellerPortal(client, {
    action: 'requestPayout',
    tenantId: id,
    sellerId: id,
    requestId: id,
    amountOre: 10000,
  })
  expect(rpc).toHaveBeenCalledWith('request_my_payout', {
    p_tenant: id,
    p_seller: id,
    p_id: id,
    p_amount_ore: 10000,
  })
  expect(
    sellerPortalCommand.safeParse({
      action: 'approvePayout',
      tenantId: id,
      sellerId: id,
      requestId: id,
    }).success,
  ).toBe(false)
  expect(
    sellerPortalCommand.safeParse({
      action: 'requestPayout',
      tenantId: id,
      sellerId: id,
      requestId: id,
      amountOre: 1.5,
    }).success,
  ).toBe(false)
  expect(
    sellerPortalCommand.safeParse({
      action: 'notifications',
      tenantId: id,
      sellerId: id,
      requestId: id,
      enabled: false,
      actor: id,
    }).success,
  ).toBe(false)
})
it('strips private account data and rejects unsafe statement amounts', () => {
  expect(
    sellerAccounts.parse([
      { tenantId: id, sellerId: id, storeName: 'Shop', privateNote: 'secret' },
    ])[0],
  ).not.toHaveProperty('privateNote')
  expect(
    sellerStatement.safeParse({
      header: {
        id,
        number: 1,
        kind: 'statement',
        opening_ore: Number.MAX_SAFE_INTEGER + 1,
        closing_ore: 0,
        period_from: '2000-01-01',
        period_to: '2001-01-01',
      },
      lines: [],
    }).success,
  ).toBe(false)
  expect(safeNext('/seller')).toBe('/seller')
  expect(safeNext('//evil.example/seller')).toBe('/')
})
