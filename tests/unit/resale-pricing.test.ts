import { describe, it, expect } from 'vitest'
import {
  resaleProfile,
  eligiblePriceEvidence,
} from '../../lib/assistance/resale-pricing'
const tenant = 'f0000000-0000-4000-8000-000000008001'
const market = { country: 'SE', currency: 'SEK', language: 'en' }
const sale = {
  id: 'f0000000-0000-4000-8000-000000008002',
  kind: 'store_sale',
  tenantId: tenant,
  saleId: tenant,
  itemId: tenant,
  amount: '250.00',
  currency: 'SEK',
  category: 'jacket',
  brand: null,
  condition: 'Used, no visible damage',
  observedAt: '2026-10-08T08:00:00Z',
  soldAt: '2026-10-01T08:00:00Z',
  reversed: false,
}
const listing = {
  id: 'f0000000-0000-4000-8000-000000008003',
  kind: 'web_listing',
  amount: '300.00',
  currency: 'SEK',
  category: 'jacket',
  brand: null,
  condition: 'Used',
  observedAt: '2026-10-08T08:00:00Z',
  url: 'https://example.test/items/1',
  marketCountry: 'SE',
  status: 'asking',
  priceBasis: 'item_only',
  verification: 'retrieved_page',
  soldAt: null,
}
describe('resale evidence boundary', () => {
  it('uses market rather than display language', () => {
    expect(resaleProfile(market).profile).toBe('swedish-resale-pricing')
    expect(
      resaleProfile({ ...market, country: 'NO', language: 'sv' }).profile,
    ).toBeNull()
    expect(resaleProfile({ ...market, currency: 'EUR' }).profile).toBeNull()
  })
  it('keeps asking prices distinct from achieved prices', () => {
    expect(eligiblePriceEvidence(tenant, market, [sale, listing])).toEqual([
      sale,
      listing,
    ])
  })
  it.each([
    { ...sale, reversed: true },
    { ...sale, currency: 'EUR' },
    { ...listing, verification: 'search_snippet' },
    { ...listing, status: 'ended_unknown' },
    { ...listing, priceBasis: 'unknown' },
    { ...listing, marketCountry: 'NO' },
  ])('excludes unsuitable evidence', (row) => {
    expect(eligiblePriceEvidence(tenant, market, [row])).toEqual([])
  })
  it('rejects cross-tenant history rather than masking it', () => {
    expect(() =>
      eligiblePriceEvidence(tenant, market, [
        { ...sale, tenantId: listing.id },
      ]),
    ).toThrow('TENANT_MISMATCH')
  })
  it('requires a sale date before treating a listing as sold', () => {
    expect(() =>
      eligiblePriceEvidence(tenant, market, [{ ...listing, status: 'sold' }]),
    ).toThrow()
  })
  it('rejects duplicate source ids and ambiguous monetary values', () => {
    expect(() => eligiblePriceEvidence(tenant, market, [sale, sale])).toThrow(
      'DUPLICATE_EVIDENCE',
    )
    expect(() =>
      eligiblePriceEvidence(tenant, market, [{ ...sale, amount: 250 }]),
    ).toThrow()
    expect(() =>
      eligiblePriceEvidence(tenant, market, [{ ...sale, amount: '250,00' }]),
    ).toThrow()
  })
})
