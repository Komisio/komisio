import { expect, it } from 'vitest'
import { renderSie4, sieAmount, sieText } from '../../lib/accounting/sie'

const lines = [
  { key: 'grossOre', account: '1930', side: 'debit', amountOre: 20000 },
  { key: 'sellerCreditOre', account: '2890', side: 'credit', amountOre: 8000 },
  { key: 'commissionOre', account: '3010', side: 'credit', amountOre: 9600 },
  { key: 'commissionVatOre', account: '2610', side: 'credit', amountOre: 2400 },
]

it('formats amounts with debit positive and credit negative', () => {
  expect(sieAmount(20000, 'debit')).toBe('200.00')
  expect(sieAmount(2405, 'credit')).toBe('-24.05')
  expect(sieAmount(0, 'credit')).toBe('0.00')
})

it('keeps SIE text ASCII, quoted and free of quotes or control characters', () => {
  expect(sieText('Kläder & Åter"bruk\n')).toBe('"Klader & Aterbruk"')
})

it('renders one balanced voucher in series A with the store name', () => {
  const file = renderSie4({
    storeName: 'Återbruket',
    closeDate: '2026-09-10',
    closeVersion: 1,
    generatedOn: '2026-09-13',
    lines,
  })
  expect(file.split('\r\n').slice(0, 7)).toEqual([
    '#FLAGGA 0',
    '#FORMAT PC8',
    '#SIETYP 4',
    '#PROGRAM "Komisio" "1"',
    '#GEN 20260913',
    '#FNAMN "Aterbruket"',
    '#VER "A" "" 20260910 "Dagsavslut 2026-09-10 v1"',
  ])
  expect(file).toContain('#TRANS 1930 {} 200.00')
  expect(file).toContain('#TRANS 2610 {} -24.00')
  expect(file.endsWith('}\r\n')).toBe(true)
})

it('refuses an unbalanced voucher and bad accounts', () => {
  expect(() =>
    renderSie4({
      storeName: 'S',
      closeDate: '2026-09-10',
      closeVersion: 1,
      generatedOn: '2026-09-13',
      lines: lines.slice(0, 2),
    }),
  ).toThrow('VOUCHER_UNBALANCED')
  expect(() =>
    renderSie4({
      storeName: 'S',
      closeDate: '2026-09-10',
      closeVersion: 1,
      generatedOn: '2026-09-13',
      lines: [{ ...lines[0], account: '193' }],
    }),
  ).toThrow()
})
