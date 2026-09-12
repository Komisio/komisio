import { it, expect } from 'vitest'
import {
  vatForLine,
  commissionInvoiceVat,
  vatWorkedExamples,
  selectVatMode,
  vatPolicy,
  defaultVatPolicy,
  rateBasisPointsFromPercent,
} from '../../lib/engine/vat'

it('computes every worked example exactly as documented', () => {
  for (const e of vatWorkedExamples)
    expect(
      vatForLine(e.mode, e.basis, e.rateBp),
      `${e.mode} ${JSON.stringify(e.basis)}`,
    ).toBe(e.vatOre)
})
it('adds VAT on top of a net commission for business sellers', () => {
  expect(commissionInvoiceVat(12_000, 2_500)).toBe(3_000)
  // 1 öre × 2500 ÷ 10000 = 0.25 → 0; 2 öre → 0.5 → 1 (half up).
  expect(commissionInvoiceVat(1, 2_500)).toBe(0)
  expect(commissionInvoiceVat(2, 2_500)).toBe(1)
})
it('fails closed when the basis for a mode is missing or the mode is unknown', () => {
  expect(() =>
    vatForLine('consignment_margin', { priceOre: 100 }, 2500),
  ).toThrow('VAT_BASIS_MISSING')
  expect(() => vatForLine('store_margin', { priceOre: 100 }, 2500)).toThrow(
    'VAT_BASIS_MISSING',
  )
  expect(() => vatForLine('agency', { priceOre: 100 }, 2500)).toThrow()
  expect(() => vatForLine('store_full', { priceOre: 1.5 }, 2500)).toThrow()
  expect(() => vatForLine('store_full', { priceOre: 100 }, 2500.5)).toThrow()
  expect(() =>
    vatForLine('store_full', { priceOre: 100, vatOre: 5 }, 2500),
  ).toThrow()
})
it('selects one mode per line from item facts and tenant policy', () => {
  const policy = {
    vatModeConsignmentPrivate: 'consignment_margin',
    vatModeStoreOwned: 'store_margin',
    vatRatePercent: '25.00',
  }
  const line = (
    ownership: 'consignment' | 'store',
    sellerTaxable = false,
    marginAttested = false,
  ) => ({ ownership, sellerTaxable, marginAttested })
  expect(selectVatMode(line('consignment'), policy)).toBe('consignment_margin')
  expect(selectVatMode(line('consignment', true), policy)).toBe(
    'consignment_business',
  )
  expect(selectVatMode(line('store', false, true), policy)).toBe('store_margin')
  // No attestation: never margin taxed.
  expect(selectVatMode(line('store'), policy)).toBe('store_full')
  expect(
    selectVatMode(line('store', false, true), {
      ...policy,
      vatModeStoreOwned: 'store_full',
    }),
  ).toBe('store_full')
})
it('refuses to guess a mode the tenant has not chosen', () => {
  expect(() =>
    selectVatMode(
      { ownership: 'consignment', sellerTaxable: false, marginAttested: false },
      defaultVatPolicy,
    ),
  ).toThrow('VAT_MODE_NOT_SET')
  expect(() =>
    selectVatMode(
      { ownership: 'store', sellerTaxable: false, marginAttested: true },
      defaultVatPolicy,
    ),
  ).toThrow('VAT_MODE_NOT_SET')
  // A business seller needs no private-seller choice.
  expect(
    selectVatMode(
      { ownership: 'consignment', sellerTaxable: true, marginAttested: false },
      defaultVatPolicy,
    ),
  ).toBe('consignment_business')
  expect(() => vatPolicy.parse({ vatRatePercent: '25' })).toThrow()
  expect(() => vatPolicy.parse({ vatRatePercent: 25 })).toThrow()
})
it('converts exact percent text to basis points', () => {
  expect(rateBasisPointsFromPercent('25.00')).toBe(2500)
  expect(rateBasisPointsFromPercent('12.50')).toBe(1250)
  expect(rateBasisPointsFromPercent('0.00')).toBe(0)
  expect(() => rateBasisPointsFromPercent('25')).toThrow()
  expect(() => rateBasisPointsFromPercent('100.01')).toThrow()
})
it('never uses floating point for large amounts', () => {
  // 99 999 999 999 öre × 2500 exceeds 2^53; BigInt keeps it exact.
  expect(vatForLine('store_full', { priceOre: 99_999_999_999 }, 2500)).toBe(
    20_000_000_000,
  )
})
