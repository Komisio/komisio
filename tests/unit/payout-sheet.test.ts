import { expect, it } from 'vitest'
import {
  paymentSheetCsv,
  type PaymentSheet,
} from '../../lib/engine/payout-sheet'

const sheet: PaymentSheet = {
  store: 'Synthetic store',
  generatedAt: '2026-10-09T12:00:00Z',
  page: 2,
  currency: 'SEK',
  rows: [
    { id: 'synthetic-payout', seller: 'Name; with "quotes"', amountOre: 15001 },
  ],
}
it('exports the displayed snapshot with exact minor units and quoted fields', () => {
  const csv = paymentSheetCsv(sheet, [
    'Store',
    'Snapshot',
    'Page',
    'ID',
    'Seller',
    'Amount',
    'Currency',
  ])
  expect(csv).toContain(
    '"2";"synthetic-payout";"Name; with ""quotes""";"150.01";"SEK"',
  )
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain(sheet.generatedAt)
})
it.each(['=HYPERLINK("x")', ' +1', '\t@SUM(1)', '-1', '\nformula'])(
  'neutralizes spreadsheet formulas in names: %s',
  (seller) => {
    const csv = paymentSheetCsv(
      { ...sheet, rows: [{ ...sheet.rows[0], seller }] },
      [],
    )
    expect(csv).toContain(`"'${seller.replaceAll('"', '""')}"`)
  },
)
it.each([1.5, -100, Number.MAX_SAFE_INTEGER + 1, NaN])(
  'rejects non-positive or unsafe money: %s',
  (amountOre) => {
    expect(() =>
      paymentSheetCsv(
        { ...sheet, rows: [{ ...sheet.rows[0], amountOre }] },
        [],
      ),
    ).toThrow()
  },
)
