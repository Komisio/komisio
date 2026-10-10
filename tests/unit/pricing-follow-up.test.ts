import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pricingFollowUp,
  pricingPeriod,
  readPricingFollowUp,
  recentPricingPeriod,
} from '../../lib/engine/pricing-follow-up'

const report = {
  from: '2026-09-01',
  to: '2026-09-30',
  asOf: '2026-10-10T10:00:00Z',
  marketCountry: 'SE',
  currency: 'SEK',
  receivedItems: 1,
  withoutAssessment: 0,
  otherMarketOrCurrency: 0,
  invalidTiming: 0,
  cohort: {
    version: 1,
    marketCountry: 'SE',
    currency: 'SEK',
    observations: [
      {
        itemId: '10000000-0000-4000-8000-000000000001',
        currency: 'SEK',
        prediction: null,
        staffDecision: { at: '2026-09-05T10:00:00Z', priceOre: 10000 },
        sale: null,
      },
    ],
  },
}
describe('pricing follow-up read boundary', () => {
  it('keeps the Stockholm date across midnight and DST without changing period length', () => {
    expect(recentPricingPeriod(new Date('2026-03-29T22:30:00Z'))).toEqual({
      from: '2025-12-31',
      to: '2026-03-30',
    })
    expect(recentPricingPeriod(new Date('2026-10-25T23:30:00Z'))).toEqual({
      from: '2026-07-29',
      to: '2026-10-26',
    })
    expect(
      pricingPeriod.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    ).toBe(false)
    expect(
      pricingPeriod.safeParse({ from: '2026-10-01', to: '2026-09-01' }).success,
    ).toBe(false)
    expect(
      pricingPeriod.safeParse({ from: '2024-10-01', to: '2026-09-01' }).success,
    ).toBe(false)
  })
  it('requires complete counts and matching market and currency', () => {
    expect(pricingFollowUp.parse(report).cohort?.observations).toHaveLength(1)
    for (const patch of [
      { receivedItems: 2 },
      { withoutAssessment: 1 },
      { marketCountry: 'DE' },
      { currency: 'EUR' },
      { invalidTiming: 2 },
      { cohort: null },
    ])
      expect(pricingFollowUp.safeParse({ ...report, ...patch }).success).toBe(
        false,
      )
  })
  it('allows an empty market/cohort but never substitutes zero accuracy', () => {
    expect(
      pricingFollowUp.parse({
        ...report,
        marketCountry: null,
        receivedItems: 0,
        cohort: null,
      }).cohort,
    ).toBeNull()
  })
  it('uses the caller-scoped read and checks the returned window', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: report, error: null })
    const client = { rpc } as unknown as SupabaseClient
    const tenant = '10000000-0000-4000-8000-000000000002'
    await expect(
      readPricingFollowUp(client, tenant, { from: report.from, to: report.to }),
    ).resolves.toEqual(report)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('pricing_follow_up', {
      p_tenant: tenant,
      p_from: report.from,
      p_to: report.to,
    })
    rpc.mockResolvedValue({
      data: { ...report, to: '2026-09-29' },
      error: null,
    })
    await expect(
      readPricingFollowUp(client, tenant, { from: report.from, to: report.to }),
    ).rejects.toThrow('UNCONFIRMED_RESULT')
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'PERIOD_TOO_LARGE' },
    })
    await expect(
      readPricingFollowUp(client, tenant, { from: report.from, to: report.to }),
    ).rejects.toThrow('PERIOD_TOO_LARGE')
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Internal private data' },
    })
    await expect(
      readPricingFollowUp(client, tenant, { from: report.from, to: report.to }),
    ).rejects.toThrow('REQUEST_FAILED')
  })
})
