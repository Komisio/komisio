import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSaleSummary } from '../../lib/engine/sale-summary'
const mocks = vi.hoisted(() => ({
  sale: vi.fn(),
  profile: vi.fn(),
  returns: vi.fn(),
  label: vi.fn(),
}))
vi.mock('../../lib/engine/sales', () => ({ readSale: mocks.sale }))
vi.mock('../../lib/engine/store-profile', () => ({
  readStoreProfile: mocks.profile,
}))
vi.mock('../../lib/engine/returns', () => ({
  readReturnsForLines: mocks.returns,
}))
vi.mock('../../lib/engine/item-label', () => ({ readItemLabel: mocks.label }))
const client = {} as SupabaseClient
const tenant = { id: 'tenant', name: 'Synthetic store' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.sale.mockResolvedValue({
    sale: {
      id: 'sale',
      external_id: 'REF-1',
      currency: 'DKK',
      total_ore: 12345,
      occurred_at: '2026-10-01T10:00:00Z',
      status: 'completed',
      staff_note: 'PRIVATE STAFF NOTE',
    },
    lines: [
      {
        id: 'line',
        item_id: '12345678-1234-4123-8123-123456789012',
        price_ore: 12345,
        seller_credit_ore: 10000,
        commission_ore: 2345,
        vat_ore: 469,
      },
    ],
  })
  mocks.profile.mockResolvedValue({
    profile: {
      language: 'dk',
      address: { street: 'Testgade 1', postalCode: '1000', city: 'Testby' },
      contact: { email: 'private@example.test' },
    },
  })
  mocks.label.mockResolvedValue({
    title: 'Jakke',
    priceOre: '99900',
    currency: 'SEK',
    attributes: [],
  })
  mocks.returns.mockResolvedValue(
    new Map([
      [
        'line',
        {
          occurred_at: '2026-10-02T10:00:00Z',
          refund_ore: 12345,
          reason: 'PRIVATE RETURN NOTE',
          flagged_for_review: true,
        },
      ],
    ]),
  )
})
it('exports only customer fields using sale prices/currency and separate returns', async () => {
  const result = await readSaleSummary(client, tenant, 'sale', 'sv')
  expect(result).toMatchObject({
    locale: 'dk',
    currency: 'DKK',
    totalOre: '12345',
    address: 'Testgade 1, 1000 Testby',
    lines: [
      { title: 'Jakke', priceOre: '12345', returned: { amountOre: '12345' } },
    ],
  })
  const text = JSON.stringify(result)
  for (const privateValue of [
    'PRIVATE',
    'seller_credit',
    'commission',
    'vat_ore',
    'private@example.test',
    '99900',
  ])
    expect(text).not.toContain(privateValue)
  expect(mocks.label).toHaveBeenCalledWith(
    client,
    tenant.id,
    '12345678-1234-4123-8123-123456789012',
  )
})
it('preserves an item reference without inventing a description and uses fallback language', async () => {
  mocks.label.mockResolvedValue(null)
  mocks.profile.mockResolvedValue({ profile: null })
  mocks.returns.mockResolvedValue(new Map())
  const result = await readSaleSummary(client, tenant, 'sale', 'fi')
  expect(result).toMatchObject({
    locale: 'fi',
    address: '',
    lines: [{ reference: 'I-12345678', title: '', returned: null }],
  })
})
it('does not read supplementary facts for a missing/inaccessible sale', async () => {
  mocks.sale.mockResolvedValue(null)
  expect(await readSaleSummary(client, tenant, 'absent', 'sv')).toBeNull()
  expect(mocks.profile).not.toHaveBeenCalled()
  expect(mocks.label).not.toHaveBeenCalled()
})
