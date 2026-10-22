import { describe, expect, it } from 'vitest'
import { accountingMapBody } from '../../lib/engine/accounting'
import { economicMapBody } from '../../lib/engine/economic'
import { voucherBody } from '../../extensions/fortnox/vouchers'
import { draftBody } from '../../extensions/economic/api'
import { dictionary, locales } from '../../lib/i18n'

const pair = {
  payoutsPaidOre: { account: '1930', side: 'credit' },
  payoutsPaidCounterpartOre: { account: '2890', side: 'debit' },
}
const economicPair = Object.fromEntries(
  Object.entries(pair).map(([key, value]) => [
    key,
    { ...value, vatCode: 'Z0' },
  ]),
)

describe('paid payout accounting', () => {
  it('accepts the reviewed pair and keeps historic one-sided maps readable', () => {
    expect(accountingMapBody.safeParse(pair).success).toBe(true)
    expect(economicMapBody.safeParse(economicPair).success).toBe(true)
    expect(
      accountingMapBody.safeParse({ payoutsPaidOre: pair.payoutsPaidOre })
        .success,
    ).toBe(true)
  })

  it.each([
    { ...pair, payoutsPaidCounterpartOre: { account: '2890', side: 'credit' } },
    { ...pair, payoutsPaidCounterpartOre: { account: '1930', side: 'debit' } },
    { payoutsPaidCounterpartOre: pair.payoutsPaidCounterpartOre },
  ])('refuses an incomplete or contradictory new pair', (map) => {
    expect(accountingMapBody.safeParse(map).success).toBe(false)
    expect(
      economicMapBody.safeParse(
        Object.fromEntries(
          Object.entries(map).map(([key, value]) => [
            key,
            { ...value, vatCode: 'Z0' },
          ]),
        ),
      ).success,
    ).toBe(false)
  })

  it('requires both economic payout legs to be explicitly excluded together', () => {
    const excluded = { excludeReason: 'Recorded externally' }
    expect(
      economicMapBody.safeParse({
        ...economicPair,
        payoutsPaidCounterpartOre: excluded,
      }).success,
    ).toBe(false)
    expect(
      economicMapBody.safeParse({
        payoutsPaidOre: excluded,
        payoutsPaidCounterpartOre: excluded,
      }).success,
    ).toBe(true)
  })

  it('carries both frozen payout postings into the Fortnox voucher', () => {
    const body = voucherBody({
      transactionDate: '2026-10-22',
      description: 'Synthetic paid payout',
      lines: [
        { account: '1930', side: 'credit', amountOre: 12345 },
        { account: '2890', side: 'debit', amountOre: 12345 },
      ],
    })
    expect(body.Voucher.VoucherRows).toEqual([
      { Account: 1930, Debit: 0, Credit: 123.45 },
      { Account: 2890, Debit: 123.45, Credit: 0 },
    ])
  })

  it('carries both frozen payout postings into one economic draft', () => {
    const body = draftBody({
      journalNumber: 1,
      date: '2026-10-22',
      description: 'Synthetic paid payout',
      lines: [
        {
          key: 'payoutsPaidOre',
          account: '1930',
          side: 'credit',
          amountOre: 12345,
          vatCode: 'Z0',
        },
        {
          key: 'payoutsPaidCounterpartOre',
          account: '2890',
          side: 'debit',
          amountOre: 12345,
          vatCode: 'Z0',
        },
      ],
    })
    expect(
      body.entries.map(({ accountNumber, amount, vatCode }) => ({
        accountNumber,
        amount,
        vatCode,
      })),
    ).toEqual([
      { accountNumber: 1930, amount: '-123.45', vatCode: 'Z0' },
      { accountNumber: 2890, amount: '123.45', vatCode: 'Z0' },
    ])
  })

  it.each(locales)('labels the counterpart in %s', (locale) => {
    expect(
      dictionary(locale).accounting.amountKeys.payoutsPaidCounterpartOre,
    ).toBeTruthy()
  })
})
