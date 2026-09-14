import { describe, expect, it } from 'vitest'
import {
  briefFacts,
  percentChange,
  renderBrief,
  type EconomyBrief,
} from '../../lib/engine/brief'
import { dictionary } from '../../lib/i18n'

const zero = {
  salesCount: 0,
  linesCount: 0,
  grossOre: 0,
  vatOre: 0,
  netOre: 0,
  commissionOre: 0,
  commissionVatOre: 0,
  sellerCreditOre: 0,
  returnsCount: 0,
  refundsOre: 0,
  creditReversedOre: 0,
  payoutsPaidCount: 0,
  payoutsPaidOre: 0,
}
const brief: EconomyBrief = {
  kind: 'week',
  anchor: '2026-09-12',
  currency: 'SEK',
  timeZone: 'Europe/Stockholm',
  period: { from: '2026-09-07', to: '2026-09-13' },
  previousPeriod: { from: '2026-08-31', to: '2026-09-06' },
  current: {
    ...zero,
    salesCount: 4,
    linesCount: 5,
    grossOre: 120000,
    commissionOre: 48000,
    sellerCreditOre: 72000,
    returnsCount: 1,
    refundsOre: 20000,
    payoutsPaidCount: 2,
    payoutsPaidOre: 50000,
  },
  previous: { ...zero, salesCount: 2, grossOre: 80000, sellerCreditOre: 48000 },
  days: [
    {
      date: '2026-09-08',
      salesCount: 1,
      grossOre: 20000,
      sellerCreditOre: 12000,
    },
    {
      date: '2026-09-11',
      salesCount: 3,
      grossOre: 100000,
      sellerCreditOre: 60000,
    },
  ],
  bestDay: { date: '2026-09-11', salesCount: 3, grossOre: 100000 },
  itemsAccepted: 10,
  previousItemsAccepted: 0,
  liability: {
    availableOre: 30000,
    reservedOre: 5000,
    owedOre: 35000,
    sellersWithEntries: 3,
  },
  openPayouts: { count: 1, amountOre: 5000 },
}

describe('brief facts', () => {
  it('computes whole-percent changes and rates, null without a base', () => {
    expect(percentChange(120000, 80000)).toBe(50)
    expect(percentChange(60000, 80000)).toBe(-25)
    expect(percentChange(5, 0)).toBeNull()
    const f = briefFacts(brief)
    expect(f.grossChange).toBe(50)
    expect(f.salesChange).toBe(100)
    expect(f.acceptedChange).toBeNull()
    expect(f.returnRatePercent).toBe(25)
    expect(f.sellDaysCount).toBe(2)
    expect(f.averageSaleOre).toBe(30000)
  })
  it('renders the same sentences for the same numbers, in both languages', () => {
    const sv = renderBrief(brief, dictionary('sv').brief)
    const en = renderBrief(brief, dictionary('en').brief)
    expect(sv.title).toContain('2026-09-07')
    expect(sv.lines).toEqual(renderBrief(brief, dictionary('sv').brief).lines)
    expect(en.lines.join(' ')).toContain('1200.00 SEK')
    expect(en.lines.join(' ')).toContain('50%')
    expect(en.lines.join(' ')).toContain('2026-09-11')
    expect(en.lines.some((l) => l.includes('{'))).toBe(false)
    expect(sv.lines.some((l) => l.includes('{'))).toBe(false)
    expect(en.lines.length).toBe(sv.lines.length)
  })
  it('renders a quiet period without comparisons', () => {
    const quiet = renderBrief(
      {
        ...brief,
        current: zero,
        days: [],
        bestDay: null,
        openPayouts: { count: 0, amountOre: 0 },
      },
      dictionary('en').brief,
    )
    expect(quiet.lines[0]).toContain('No sales')
    expect(quiet.lines.some((l) => l.includes('%'))).toBe(false)
    expect(quiet.lines.some((l) => l.includes('{'))).toBe(false)
  })
})
