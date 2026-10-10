import { expect, it } from 'vitest'
import {
  stocktakeCsv,
  stocktakeExport,
  type StocktakeExport,
} from '../../lib/engine/stocktake-export'
import sv from '../../messages/sv.json'
import en from '../../messages/en.json'

const report: StocktakeExport = {
  id: '00000000-0000-4000-8000-000000000001',
  version: 2,
  startedAt: '2026-10-10T10:00:00Z',
  closedAt: '2026-10-10T11:00:00Z',
  filter: 'all',
  rows: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Jacket; "blue"\nCotton',
      expected: true,
      changed: false,
      observation: 'damaged',
      version: 1,
      reason: 'Zip broken',
      actor: 'Synthetic staff',
      at: '2026-10-10T10:30:00Z',
    },
  ],
}
it('exports the exact closed count with localized headings, observations and quoted newlines', () => {
  const csv = stocktakeCsv(report, 'Synthetic store', sv.stocktake)
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain('"Jacket; ""blue""\nCotton"')
  expect(csv).toContain(sv.stocktake.damaged)
  expect(csv).toContain(report.closedAt)
  expect(csv).toContain(report.rows[0].id)
  expect(stocktakeCsv(report, 'Synthetic store', en.stocktake)).toContain(
    '"Damaged"',
  )
})
it.each(['=HYPERLINK("x")', ' +1', '\t@SUM(1)', '-1', '\nformula'])(
  'neutralizes formulas in item titles, comments and staff names: %s',
  (value) => {
    const csv = stocktakeCsv(
      {
        ...report,
        rows: [
          { ...report.rows[0], title: value, reason: value, actor: value },
        ],
      },
      value,
      en.stocktake,
    )
    expect(csv.split(`"'${value.replaceAll('"', '""')}"`)).toHaveLength(5)
  },
)
it('distinguishes discrepancies from findings and retains an empty selection', () => {
  const csv = stocktakeCsv(
    {
      ...report,
      filter: 'deviations',
      rows: [
        {
          ...report.rows[0],
          observation: 'unchecked',
          changed: true,
          expected: false,
        },
      ],
    },
    'Store',
    en.stocktake,
  )
  expect(csv).toContain('"Unchecked"')
  expect(csv).toContain('"No longer in stock · Outside starting list"')
  expect(
    stocktakeCsv({ ...report, rows: [] }, 'Store', en.stocktake).split('\r\n'),
  ).toHaveLength(2)
})
it('rejects oversized output and oversized responses rather than silently truncating', () => {
  expect(() =>
    stocktakeCsv(
      {
        ...report,
        rows: [{ ...report.rows[0], title: 'å'.repeat(1_800_000) }],
      },
      'Store',
      sv.stocktake,
    ),
  ).toThrow('STOCKTAKE_EXPORT_TOO_LARGE')
  expect(
    stocktakeExport.safeParse({
      ...report,
      rows: Array(5001).fill(report.rows[0]),
    }).success,
  ).toBe(false)
})
