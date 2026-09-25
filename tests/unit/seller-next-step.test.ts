import { describe, expect, it } from 'vitest'
import {
  myItems,
  sellerItemDaysLeft,
  sellerItemNextStep,
} from '../../lib/engine/seller-items'

const base = {
  id: '11111111-2222-4333-8444-555555555555',
  reference: 'I-11111111',
  acceptedAt: '2026-09-01T10:00:00+00:00',
  title: 'Blue coat',
  category: 'Coats',
  currentPriceOre: 30000,
  acceptedPriceOre: 30000,
  stage: 'on_sale' as const,
  periodEnd: '2026-10-13T10:00:00+00:00',
  endOfPeriodAction: 'charity' as const,
  endedAs: null,
  soldAt: null,
  soldPriceOre: null,
}

describe('seller next step', () => {
  it('reads the planned step the engine reports and never computes one', () => {
    const item = myItems.parse({
      currency: 'SEK',
      automaticMarkdowns: false,
      items: [
        {
          ...base,
          nextMarkdownAt: '2026-09-15T10:00:00+00:00',
          nextMarkdownPercent: '10',
          nextPriceOre: '27000',
        },
      ],
    }).items[0]
    expect(sellerItemNextStep(item)).toEqual({
      at: '2026-09-15T10:00:00+00:00',
      priceOre: 27000,
    })
  })
  it('accepts a response from before the migration without the fields', () => {
    const parsed = myItems.parse({ currency: 'SEK', items: [base] })
    expect(parsed.automaticMarkdowns).toBeUndefined()
    expect(sellerItemNextStep(parsed.items[0])).toBeNull()
  })
  it('shows no step for sold or ended items even when a value arrives', () => {
    for (const stage of ['sold', 'ended', 'period_ended'] as const)
      expect(
        sellerItemNextStep({
          ...base,
          stage,
          nextMarkdownAt: '2026-09-15T10:00:00+00:00',
          nextPriceOre: 27000,
        }),
      ).toBeNull()
  })
  it('counts whole days left and stops at zero', () => {
    const now = Date.parse('2026-09-25T08:00:00+00:00')
    expect(sellerItemDaysLeft(base, now)).toBe(19)
    expect(
      sellerItemDaysLeft(
        { ...base, periodEnd: '2026-09-25T09:00:00+00:00' },
        now,
      ),
    ).toBe(1)
    expect(
      sellerItemDaysLeft(
        { ...base, periodEnd: '2026-09-20T09:00:00+00:00' },
        now,
      ),
    ).toBe(0)
  })
})
