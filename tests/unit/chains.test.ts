import { describe, expect, it } from 'vitest'
import { chainEconomySummary, chainOverview } from '../../lib/engine/chains'
import { commandSchema } from '../../lib/platform/validation'

const a = '10000000-0000-4000-8000-00000000000a'
const b = '10000000-0000-4000-8000-00000000000b'

describe('chains', () => {
  it('parses the overview with per-store roles and null without a chain', () => {
    expect(chainOverview.parse(null)).toBeNull()
    const o = chainOverview.parse({
      id: a,
      name: 'Second Life AB',
      createdAt: '2026-09-15T10:00:00+00:00',
      stores: [
        { id: a, name: 'A', slug: 'a', role: 'owner' },
        { id: b, name: 'B', slug: 'b', role: null },
      ],
    })
    expect(o?.stores[1].role).toBeNull()
  })
  it('parses the summary with money as numbers and a null total on mixed currencies', () => {
    const totals = {
      salesCount: 1,
      linesCount: 1,
      grossOre: '20000',
      vatOre: 0,
      netOre: 20000,
      commissionOre: 12000,
      commissionVatOre: 0,
      sellerCreditOre: 8000,
      returnsCount: 0,
      refundsOre: 0,
      creditReversedOre: 0,
      payoutsPaidCount: 0,
      payoutsPaidOre: 0,
    }
    const s = chainEconomySummary.parse({
      chainId: a,
      from: '2026-09-01',
      to: '2026-09-30',
      timeZone: 'Europe/Stockholm',
      storeCount: 2,
      currency: null,
      mixedCurrencies: true,
      stores: [
        {
          id: a,
          name: 'A',
          slug: 'a',
          currency: 'SEK',
          totals,
          liability: { owedOre: '8000' },
          openPayouts: { count: 0, amountOre: 0 },
        },
        {
          id: b,
          name: 'B',
          slug: 'b',
          currency: 'NOK',
          totals,
          liability: { owedOre: 0 },
          openPayouts: { count: 0, amountOre: 0 },
        },
      ],
      total: null,
    })
    expect(s.stores[0].totals.grossOre).toBe(20000)
    expect(s.stores[0].liability.owedOre).toBe(8000)
    expect(s.total).toBeNull()
  })
  it('accepts the chain commands and rejects malformed ones', () => {
    expect(
      commandSchema.safeParse({
        action: 'chainCreate',
        tenantId: a,
        chainId: b,
        name: 'X',
        tenantIds: [a],
      }).success,
    ).toBe(true)
    expect(
      commandSchema.safeParse({
        action: 'chainJoin',
        tenantId: a,
        chainId: b,
        storeId: b,
      }).success,
    ).toBe(true)
    expect(
      commandSchema.safeParse({ action: 'chainLeave', tenantId: a }).success,
    ).toBe(true)
    for (const bad of [
      {
        action: 'chainCreate',
        tenantId: a,
        chainId: b,
        name: '',
        tenantIds: [a],
      },
      {
        action: 'chainCreate',
        tenantId: a,
        chainId: b,
        name: 'X',
        tenantIds: [],
      },
      {
        action: 'chainCreate',
        tenantId: a,
        chainId: 'nope',
        name: 'X',
        tenantIds: [a],
      },
      { action: 'chainJoin', tenantId: a, chainId: b },
      { action: 'chainLeave' },
    ])
      expect(commandSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      )
  })
})
